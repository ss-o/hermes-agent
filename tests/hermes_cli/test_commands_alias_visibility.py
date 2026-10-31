"""Aliases resolve everywhere but no listing or suggestion surface shows them."""

from prompt_toolkit.buffer import Buffer
from prompt_toolkit.completion import CompleteEvent
from prompt_toolkit.document import Document

from hermes_cli.commands import (
    COMMAND_REGISTRY,
    COMMANDS,
    COMMANDS_BY_CATEGORY,
    gateway_help_lines,
    resolve_command,
)
from hermes_cli.commands_completion import SlashCommandAutoSuggest, SlashCommandCompleter


def _aliases() -> dict[str, str]:
    return {f"/{alias}": f"/{cmd.name}" for cmd in COMMAND_REGISTRY for alias in cmd.aliases}


def _completed_names(text: str) -> set[str]:
    completions = SlashCommandCompleter().get_completions(
        Document(text=text), CompleteEvent(completion_requested=True))
    return {c.display_text for c in completions}


def _ghost(text: str) -> str:
    suggestion = SlashCommandAutoSuggest().get_suggestion(Buffer(), Document(text=text))
    return suggestion.text if suggestion else ""


def test_aliases_still_resolve_and_stay_in_the_lookup_table():
    for alias, canonical in _aliases().items():
        assert resolve_command(alias) is resolve_command(canonical), alias
        if canonical in COMMANDS:
            assert alias in COMMANDS, alias


def test_help_listing_has_every_command_and_no_alias():
    listed = {name for commands in COMMANDS_BY_CATEGORY.values() for name in commands}
    assert listed == {f"/{cmd.name}" for cmd in COMMAND_REGISTRY if not cmd.gateway_only}
    assert "/queue" in listed
    assert "/q" not in listed


def test_gateway_help_does_not_name_aliases():
    lines = gateway_help_lines()
    assert any(line.startswith("`/queue") for line in lines)
    assert not any("(alias:" in line.lower() for line in lines)
    for alias in _aliases():
        assert not any(f"`{alias}`" in line for line in lines), alias


def test_completion_menu_never_offers_an_alias():
    for alias in _aliases():
        assert alias not in _completed_names(alias), alias
    assert "/queue" in _completed_names("/qu")


def test_ghost_text_never_completes_to_an_alias():
    for alias in _aliases():
        for length in range(1, len(alias)):
            prefix = alias[:length]
            assert prefix + _ghost(prefix) != alias, alias
    assert _ghost("/que") == "ue"
