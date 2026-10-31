"""Tests for the /version slash command."""

from unittest.mock import patch

import pytest

from cli import HermesCLI






@pytest.mark.parametrize("command", ["/version", "/v"])
def test_process_command_version_prints_version_info(command):
    cli_obj = HermesCLI.__new__(HermesCLI)

    with patch("hermes_cli.main._print_version_info") as mock_print:
        assert cli_obj.process_command(command) is True

    mock_print.assert_called_once_with(check_updates=True)
