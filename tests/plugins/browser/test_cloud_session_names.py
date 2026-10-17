"""Cloud browser IPC identities stay short without changing remote lifecycle IDs."""
from __future__ import annotations

import os
from unittest.mock import Mock

import pytest

from hermes_constants import SOCKET_TMPDIR_MAX_LEN
from plugins.browser.browser_use.provider import BrowserUseBrowserProvider
from plugins.browser.browserbase.provider import BrowserbaseBrowserProvider
from plugins.browser.firecrawl.provider import FirecrawlBrowserProvider


PROVIDERS = (BrowserUseBrowserProvider, BrowserbaseBrowserProvider, FirecrawlBrowserProvider)


@pytest.fixture(params=PROVIDERS)
def cloud_provider(monkeypatch, request):
    provider = request.param()
    config = {"base_url": "https://browser.invalid", "project_id": "project", "managed_mode": False}
    cdp_url = "wss://browser.invalid/devtools/browser/remote"
    created = Mock(ok=True, status_code=201, headers={})
    created.json.return_value = {"id": "remote-session", "cdpUrl": cdp_url, "connectUrl": cdp_url}
    monkeypatch.setattr(provider, "_get_config", lambda: config)
    monkeypatch.setattr(provider, "_get_config_or_none", lambda: config)
    monkeypatch.setattr(provider, "_headers", lambda config=None: {})
    if isinstance(provider, FirecrawlBrowserProvider):
        monkeypatch.setattr(provider, "_api_url", lambda: config["base_url"])
    monkeypatch.setattr(provider, "_post_create", Mock(return_value=created))
    released = Mock(return_value=Mock(status_code=200))
    monkeypatch.setattr(provider, "_release", released)
    return provider, config, cdp_url, released


@pytest.mark.parametrize(
    "task_id", ["20260101_120000_abcdef", "task" * 128, "会話/" * 64],
    ids=["session", "long", "unicode-path"],
)
def test_cloud_names_fit_agent_browser_socket_budget(cloud_provider, task_id):
    provider, _, _, _ = cloud_provider
    name = provider.create_session(task_id)["session_name"]
    assert isinstance(name, str)
    root = "/" + "s" * (SOCKET_TMPDIR_MAX_LEN - 1)
    socket_path = os.path.join(root, f"agent-browser-{name}", f"{name}.sock")

    assert len(os.fsencode(socket_path)) <= 103
    assert name.isascii()
    assert "/" not in name and "\\" not in name


def test_cloud_session_lifecycle_keeps_remote_identity(cloud_provider):
    provider, config, cdp_url, released = cloud_provider

    first = provider.create_session("same-task")
    second = provider.create_session("same-task")

    assert first["session_name"] != second["session_name"]
    assert first["bb_session_id"] == "remote-session"
    assert first["cdp_url"] == cdp_url
    remote_id = first["bb_session_id"]
    assert isinstance(remote_id, str)
    assert provider.close_session(remote_id) is True
    released.assert_called_once_with(config, "remote-session", timeout=10)
