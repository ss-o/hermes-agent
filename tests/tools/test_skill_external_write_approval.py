"""skills.external_write_approval: stage only writes into externally owned skill roots.

Profile-local learning stays free; a write into ``skills.external_dirs`` (or a trusted project's
skills dir) stages for review, and approval replays only while the reviewed target still holds.
Real skill_manage entry points against a disposable HERMES_HOME.
"""
import importlib
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

SK = "---\nname: {n}\ndescription: Use when probing external write approval. Behavior.\n---\n# {n}\nStep 1.\n"


@pytest.fixture
def env(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "skills").mkdir(parents=True)
    ext = tmp_path / "shared"
    (ext / "shared-skill").mkdir(parents=True)
    (ext / "shared-skill" / "SKILL.md").write_text(SK.format(n="shared-skill"))
    monkeypatch.setenv("HERMES_HOME", str(home))
    monkeypatch.setenv("HERMES_YOLO_MODE", "1")

    def configure(write_approval=False, external=True, extra=""):
        (home / "config.yaml").write_text(
            "skills:\n"
            f"  write_approval: {str(write_approval).lower()}\n"
            f"  external_write_approval: {str(external).lower()}\n"
            f"  external_dirs:\n    - {ext}\n{extra}")

    configure()
    import tools.skill_manager_tool as smt
    importlib.reload(smt)
    import tools.write_approval as wa
    return {"home": home, "ext": ext, "smt": smt, "wa": wa, "configure": configure}


def _ops(smt, ops):
    return json.loads(smt.skill_manage(action="", name="", operations=ops))


def _shared_md(env):
    return (env["ext"] / "shared-skill" / "SKILL.md").read_text()


def _patch_shared(env, new="Step SHARED."):
    return _ops(env["smt"], [{"name": "shared-skill", "action": "patch",
                              "old_string": "Step 1.", "new_string": new}])


def test_local_learning_applies_without_approval(env):
    r = _ops(env["smt"], [{"name": "local-skill", "action": "create", "content": SK.format(n="local-skill")}])
    assert r["success"] and not r.get("staged"), r
    assert (env["home"] / "skills" / "local-skill" / "SKILL.md").is_file()
    assert env["wa"].pending_count("skills") == 0


@pytest.mark.parametrize("origin", ["foreground", "background_review"])
def test_external_write_stages_and_leaves_bytes_unchanged(env, origin):
    from tools.skill_provenance import reset_current_write_origin, set_current_write_origin
    before = _shared_md(env)
    token = set_current_write_origin(origin)
    try:
        r = _patch_shared(env)
    finally:
        reset_current_write_origin(token)
    assert r.get("staged"), r
    assert _shared_md(env) == before
    record = env["wa"].get_pending("skills", r["pending_id"])
    assert record["origin"] == origin
    assert record["payload"]["_binding"]["targets"][0]["dir"] == str((env["ext"] / "shared-skill").resolve())


def test_mixed_batch_stages_whole_before_touching_any_target(env):
    _ops(env["smt"], [{"name": "local-skill", "action": "create", "content": SK.format(n="local-skill")}])
    local_md = env["home"] / "skills" / "local-skill" / "SKILL.md"
    local_before, shared_before = local_md.read_text(), _shared_md(env)
    r = _ops(env["smt"], [
        {"name": "local-skill", "action": "patch", "old_string": "Step 1.", "new_string": "Step L."},
        {"name": "shared-skill", "action": "patch", "old_string": "Step 1.", "new_string": "Step S."},
    ])
    assert r.get("staged"), r
    assert local_md.read_text() == local_before and _shared_md(env) == shared_before


def test_approved_replay_applies_reviewed_change(env):
    r = _patch_shared(env)
    record = env["wa"].get_pending("skills", r["pending_id"])
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert out["success"], out
    assert "Step SHARED." in _shared_md(env)


@pytest.mark.parametrize("global_gate", [False, True])
@pytest.mark.parametrize("explicit_second_name", [False, True])
def test_default_name_batch_preview_and_approval_preserve_each_target(env, global_gate, explicit_second_name):
    from hermes_cli.write_approval_commands import handle_pending_subcommand

    env["configure"](write_approval=global_gate, external=not global_gate)
    before = _shared_md(env)
    operations = [{"action": "patch", "old_string": "Step 1.", "new_string": "Step 2."}]
    other_md = env["ext"] / "other-skill" / "SKILL.md"
    if explicit_second_name:
        other_md.parent.mkdir()
        other_md.write_text(SK.format(n="other-skill"))
        operations.append({"action": "patch", "name": "other-skill",
                           "old_string": "Step 1.", "new_string": "Step OTHER."})
    else:
        operations.append({"action": "patch", "old_string": "Step 2.", "new_string": "Step 3."})
    staged = json.loads(env["smt"].skill_manage(action="", name="shared-skill", operations=operations))
    assert staged.get("staged"), staged
    assert _shared_md(env) == before
    if explicit_second_name:
        assert other_md.read_text() == SK.format(n="other-skill")
    preview = handle_pending_subcommand("skills", ["diff", staged["pending_id"]])
    assert preview is not None
    assert "-Step 1." in preview
    assert "+Step 2." in preview
    assert "patch would fail" not in preview
    if explicit_second_name:
        assert "+Step OTHER." in preview
    else:
        assert "-Step 2." in preview and "+Step 3." in preview
    approved = handle_pending_subcommand("skills", ["approve", staged["pending_id"]])
    assert approved is not None
    assert "Approved 1 skills write(s)." in approved
    assert _shared_md(env) == before.replace("Step 1.", "Step 2." if explicit_second_name else "Step 3.")
    if explicit_second_name:
        assert other_md.read_text() == SK.format(n="other-skill").replace("Step 1.", "Step OTHER.")
    assert env["wa"].get_pending("skills", staged["pending_id"]) is None


@pytest.mark.parametrize("batch", [False, True])
def test_whole_rewrite_diff_displays_the_content_approval_applies(env, batch):
    from hermes_cli.write_approval_commands import handle_pending_subcommand

    before = _shared_md(env)
    replacement = before.replace("Step 1.", "Reviewed whole-file replacement.")
    operation = {"name": "shared-skill", "action": "patch", "content": replacement}
    staged = (_ops(env["smt"], [operation]) if batch
              else json.loads(env["smt"].skill_manage(**operation)))
    assert staged.get("staged"), staged
    assert _shared_md(env) == before
    preview = handle_pending_subcommand("skills", ["diff", staged["pending_id"]])
    assert preview is not None
    assert "-Step 1." in preview
    assert "+Reviewed whole-file replacement." in preview
    assert "patch would fail" not in preview
    approved = handle_pending_subcommand("skills", ["approve", staged["pending_id"]])
    assert approved is not None
    assert "Approved 1 skills write(s)." in approved
    assert _shared_md(env) == replacement
    assert env["wa"].get_pending("skills", staged["pending_id"]) is None


def test_whole_rewrite_batch_preview_matches_ordered_approval(env):
    from hermes_cli.write_approval_commands import handle_pending_subcommand

    before = _shared_md(env)
    replacement = before.replace("Step 1.", "Reviewed intermediate content.")
    expected = before.replace("Step 1.", "Reviewed final content.")
    staged = _ops(env["smt"], [
        {"name": "shared-skill", "action": "patch", "content": replacement},
        {"name": "shared-skill", "action": "patch",
         "old_string": "Reviewed intermediate content.", "new_string": "Reviewed final content."},
    ])
    assert staged.get("staged"), staged
    assert _shared_md(env) == before
    preview = handle_pending_subcommand("skills", ["diff", staged["pending_id"]])
    assert preview is not None
    assert "-Reviewed intermediate content." in preview
    assert "+Reviewed final content." in preview
    assert "patch would fail" not in preview
    assert "rewrite 'shared-skill'" in preview
    assert "(+0/-0 lines)" not in preview
    approved = handle_pending_subcommand("skills", ["approve", staged["pending_id"]])
    assert approved is not None
    assert "Approved 1 skills write(s)." in approved
    assert _shared_md(env) == expected


@pytest.mark.parametrize("batch", [False, True])
@pytest.mark.parametrize("mixed_fields", [
    {"old_string": "Step 1."}, {"new_string": ""}, {"new_string": "Other instructions."},
])
def test_invalid_mixed_rewrite_preview_does_not_claim_an_applicable_change(env, batch, mixed_fields):
    from hermes_cli.write_approval_commands import handle_pending_subcommand

    before = _shared_md(env)
    operation = {"name": "shared-skill", "action": "patch",
                 "content": before.replace("Step 1.", "Invalid replacement."), **mixed_fields}
    payload = ({"action": "batch", "operations": [operation, {
        "name": "shared-skill", "action": "patch", "old_string": "Step 1.",
        "new_string": "Next operation against unchanged base.",
    }]} if batch else operation)
    # Retained legacy records can predate current argument validation.
    staged = env["wa"].stage_write("skills", payload, summary="Mixed-shape legacy fixture", origin="foreground")
    preview = handle_pending_subcommand("skills", ["diff", staged["id"]])
    assert preview is not None
    assert "patch would fail" in preview
    assert "+Invalid replacement." not in preview
    if batch:
        assert "+Next operation against unchanged base." in preview
    approved = handle_pending_subcommand("skills", ["approve", staged["id"]])
    assert approved is not None
    assert "Approved 0 skills write(s)." in approved
    assert _shared_md(env) == before
    assert env["wa"].get_pending("skills", staged["id"]) is not None


def test_replay_refuses_whole_file_write_when_base_changed_after_staging(env):
    r = _ops(env["smt"], [{"name": "shared-skill", "action": "patch",
                           "content": SK.format(n="shared-skill").replace("Step 1.", "Rewritten.")}])
    record = env["wa"].get_pending("skills", r["pending_id"])
    changed = _shared_md(env).replace("Step 1.", "Step 1.\nEdited by the owner.")
    (env["ext"] / "shared-skill" / "SKILL.md").write_text(changed)
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert not out["success"], out
    assert _shared_md(env) == changed


def test_replay_refuses_when_name_retargets_to_another_root(env):
    record = env["wa"].get_pending("skills", _patch_shared(env)["pending_id"])
    shadow = env["home"] / "skills" / "shared-skill"
    shadow.mkdir()
    (shadow / "SKILL.md").write_text(SK.format(n="shared-skill"))  # local now shadows external
    shared_before = _shared_md(env)
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert not out["success"], out
    assert (shadow / "SKILL.md").read_text() == SK.format(n="shared-skill")
    assert _shared_md(env) == shared_before


def test_global_gate_still_stages_profile_local_writes(env):
    env["configure"](write_approval=True, external=False)
    r = _ops(env["smt"], [{"name": "local-skill", "action": "create", "content": SK.format(n="local-skill")}])
    assert r.get("staged"), r
    assert not (env["home"] / "skills" / "local-skill").exists()


def test_create_into_symlinked_create_dir_under_external_root_stages(env, tmp_path):
    link = tmp_path / "create-link"
    link.symlink_to(env["ext"], target_is_directory=True)
    env["configure"](extra=f"  create_dir: {link}\n")
    r = _ops(env["smt"], [{"name": "new-skill", "action": "create", "content": SK.format(n="new-skill")}])
    assert r.get("staged"), r
    assert not (env["ext"] / "new-skill").exists()


def test_unknown_ownership_fails_closed_to_staging(env):
    with patch("agent.skill_utils.is_external_skill_path", side_effect=OSError("unreadable")):
        r = _ops(env["smt"], [{"name": "local-skill", "action": "create", "content": SK.format(n="local-skill")}])
    assert r.get("staged"), r
    assert not (env["home"] / "skills" / "local-skill").exists()


def test_failed_staging_is_not_reported_as_staged(env):
    with patch("tools.write_approval.atomic_json_write", side_effect=OSError("disk full")):
        r = _patch_shared(env)
    assert r.get("success") is False and not r.get("staged"), r
    assert env["wa"].pending_count("skills") == 0
    assert "Step 1." in _shared_md(env)


def _flat(env, **kw):
    return json.loads(env["smt"].skill_manage(**kw))


def test_global_gate_keeps_sequential_approvals_and_adds_no_binding(env):
    _ops(env["smt"], [{"name": "local-skill", "action": "create",
                       "content": SK.format(n="local-skill") + "Step 2.\n"}])
    env["configure"](write_approval=True, external=False)
    first = _flat(env, action="patch", name="local-skill", old_string="Step 1.", new_string="Step A.")
    second = _flat(env, action="patch", name="local-skill", old_string="Step 2.", new_string="Step B.")
    records = [env["wa"].get_pending("skills", r["pending_id"]) for r in (first, second)]
    assert all("_binding" not in rec["payload"] for rec in records)
    for rec in records:
        assert json.loads(env["smt"].apply_skill_pending(rec["payload"]))["success"]
    body = (env["home"] / "skills" / "local-skill" / "SKILL.md").read_text()
    assert "Step A." in body and "Step B." in body


def test_local_skill_whose_skill_md_links_into_external_root_stages(env):
    local = env["home"] / "skills" / "linked-skill"
    local.mkdir()
    (local / "SKILL.md").symlink_to(env["ext"] / "shared-skill" / "SKILL.md")
    before = _shared_md(env)
    r = _flat(env, action="patch", name="linked-skill", old_string="Step 1.", new_string="Step X.")
    assert r.get("staged"), r
    assert _shared_md(env) == before


def test_replay_refuses_create_when_destination_moved(env, tmp_path):
    link = tmp_path / "create-link"
    link.symlink_to(env["ext"], target_is_directory=True)
    env["configure"](extra=f"  create_dir: {link}\n")
    r = _ops(env["smt"], [{"name": "new-skill", "action": "create", "content": SK.format(n="new-skill")}])
    record = env["wa"].get_pending("skills", r["pending_id"])
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    env["configure"](extra=f"  create_dir: {elsewhere}\n")
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert not out["success"], out
    assert not (elsewhere / "new-skill").exists() and not (env["ext"] / "new-skill").exists()


def test_replay_refuses_op_on_skill_that_appeared_after_staging(env):
    r = _ops(env["smt"], [
        {"name": "shared-skill", "action": "patch", "old_string": "Step 1.", "new_string": "Step S."},
        {"name": "later-skill", "action": "write_file", "file_path": "references/a.md", "file_content": "a"},
    ])
    record = env["wa"].get_pending("skills", r["pending_id"])
    later = env["home"] / "skills" / "later-skill"
    later.mkdir()
    (later / "SKILL.md").write_text(SK.format(n="later-skill"))
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert not out["success"], out
    assert not (later / "references").exists()


@pytest.mark.parametrize("kw", [
    {"action": "patch", "old_string": "Step 1.", "new_string": "Step F."},
    {"action": "patch", "content": SK.format(n="shared-skill").replace("Step 1.", "Edited.")},
    {"action": "edit", "content": SK.format(n="shared-skill").replace("Step 1.", "Edited.")},
    {"action": "write_file", "file_path": "references/new.md", "file_content": "x"},
    {"action": "remove_file", "file_path": "references/keep.md"},
    {"action": "delete"},
])
def test_single_op_writes_into_external_root_stage(env, kw):
    (env["ext"] / "shared-skill" / "references").mkdir()
    (env["ext"] / "shared-skill" / "references" / "keep.md").write_text("keep")
    r = _flat(env, name="shared-skill", **kw)
    assert r.get("staged"), r
    assert _shared_md(env) == SK.format(n="shared-skill")
    assert sorted(p.name for p in (env["ext"] / "shared-skill" / "references").iterdir()) == ["keep.md"]


def test_targeted_patch_binds_location_only_and_survives_unrelated_edits(env):
    first = _patch_shared(env, new="Step A.")
    second = _ops(env["smt"], [{"name": "shared-skill", "action": "patch",
                                "old_string": "# shared-skill", "new_string": "# Shared skill"}])
    md = env["ext"] / "shared-skill" / "SKILL.md"
    md.write_text(md.read_text() + "Owner note.\n")
    for r in (first, second):
        record = env["wa"].get_pending("skills", r["pending_id"])
        assert json.loads(env["smt"].apply_skill_pending(record["payload"]))["success"]
    body = _shared_md(env)
    assert "Step A." in body and "# Shared skill" in body and "Owner note." in body


def test_replay_refuses_when_skill_md_link_is_retargeted(env, tmp_path):
    local = env["home"] / "skills" / "linked-skill"
    local.mkdir()
    (local / "SKILL.md").symlink_to(env["ext"] / "shared-skill" / "SKILL.md")
    r = _flat(env, action="patch", name="linked-skill", old_string="Step 1.", new_string="Step X.")
    record = env["wa"].get_pending("skills", r["pending_id"])
    other = env["ext"] / "other.md"
    other.write_text(SK.format(n="linked-skill"))
    (local / "SKILL.md").unlink()
    (local / "SKILL.md").symlink_to(other)
    out = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert not out["success"], out
    assert "Step X." not in other.read_text()


def test_both_gates_on_still_bind_external_writes(env):
    env["configure"](write_approval=True, external=True)
    r = _ops(env["smt"], [{"name": "shared-skill", "action": "patch",
                           "content": SK.format(n="shared-skill").replace("Step 1.", "Rewritten.")}])
    record = env["wa"].get_pending("skills", r["pending_id"])
    assert "_binding" in record["payload"]
    changed = _shared_md(env) + "Owner note.\n"
    (env["ext"] / "shared-skill" / "SKILL.md").write_text(changed)
    assert not json.loads(env["smt"].apply_skill_pending(record["payload"]))["success"]
    assert _shared_md(env) == changed


def test_binding_lists_every_op_name_for_replay_locks(env):
    from tools.skill_write_binding import binding_names
    alias = env["ext"] / "aliased"
    alias.mkdir()
    (alias / "SKILL.md").write_text(SK.format(n="display-alias"))
    r = _ops(env["smt"], [
        {"name": "aliased", "action": "patch", "old_string": "Step 1.", "new_string": "Step A."},
        {"name": "display-alias", "action": "patch", "old_string": "# display-alias", "new_string": "# Alias"},
    ])
    record = env["wa"].get_pending("skills", r["pending_id"])
    assert set(binding_names(record["payload"]["_binding"])) == {"aliased", "display-alias"}
    result = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert result.get("success") is True, result
    assert "Step A." in (alias / "SKILL.md").read_text()
    assert "# Alias" in (alias / "SKILL.md").read_text()


def test_both_gates_bind_local_writes_so_a_vanished_shadow_cannot_redirect_them(env):
    shadow = env["home"] / "skills" / "shared-skill"
    shadow.mkdir()
    (shadow / "SKILL.md").write_text(SK.format(n="shared-skill"))
    env["configure"](write_approval=True, external=True)
    r = _ops(env["smt"], [{"name": "shared-skill", "action": "patch",
                           "content": SK.format(n="shared-skill").replace("Step 1.", "Rewritten.")}])
    record = env["wa"].get_pending("skills", r["pending_id"])
    (shadow / "SKILL.md").unlink()
    shadow.rmdir()
    assert not json.loads(env["smt"].apply_skill_pending(record["payload"]))["success"]
    assert _shared_md(env) == SK.format(n="shared-skill")


def test_bad_category_on_create_reports_the_category_error(env):
    r = _flat(env, action="create", name="new-skill", content=SK.format(n="new-skill"), category=5)
    assert r.get("success") is False and "ategor" in r.get("error", ""), r


def test_record_staged_before_binding_existed_still_replays(env):
    payload = {"action": "patch", "name": "shared-skill", "old_string": "Step 1.", "new_string": "Step L."}
    assert json.loads(env["smt"].apply_skill_pending(payload))["success"]
    assert "Step L." in _shared_md(env)


def test_failed_memory_staging_is_not_reported_as_staged(env):
    (env["home"] / "config.yaml").write_text("memory:\n  write_approval: true\n")
    from tools.memory_tool import load_on_disk_store, memory_tool
    with patch("tools.write_approval.atomic_json_write", side_effect=OSError("disk full")):
        r = json.loads(memory_tool(action="add", target="memory", content="fact", store=load_on_disk_store()))
    assert r.get("success") is False and not r.get("staged"), r
    assert env["wa"].pending_count("memory") == 0


def test_batch_keeps_local_target_when_skill_metadata_is_removed(env):
    from tools.registry import registry
    local = env["home"] / "skills" / "shared-skill"
    local.mkdir()
    original = SK.format(n="shared-skill").replace("Step 1.", "Local instructions.")
    (local / "SKILL.md").write_text(original)
    shared_before = _shared_md(env)
    result = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "shared-skill", "action": "remove_file", "file_path": "SKILL.md"},
        {"name": "shared-skill", "action": "write_file", "file_path": "references/local.md",
         "file_content": "Local supporting content."},
    ]}))
    assert result.get("success") is True, result
    assert _shared_md(env) == shared_before
    assert not (env["ext"] / "shared-skill" / "references" / "local.md").exists()
    assert not (local / "SKILL.md").exists()
    assert (local / "references" / "local.md").read_text() == "Local supporting content."
    assert env["wa"].pending_count("skills") == 0
    following = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "shared-skill", "action": "write_file", "file_path": "references/next.md",
         "file_content": "This is now a shared target."},
    ]}))
    assert following.get("staged") is True, following
    assert not (env["ext"] / "shared-skill" / "references" / "next.md").exists()


def test_replay_refuses_when_a_secondary_alias_resolves_to_a_new_skill(env):
    from tools.registry import registry
    original = env["ext"] / "aliased"
    (original / "references").mkdir(parents=True)
    (original / "SKILL.md").write_text(SK.format(n="display-alias"))
    (original / "references" / "a.md").write_text("Reviewed content.")
    staged = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "aliased", "action": "write_file", "file_path": "references/a.md",
         "file_content": "First operation."},
        {"name": "display-alias", "action": "write_file", "file_path": "references/a.md",
         "file_content": "Second operation."},
    ]}))
    assert staged.get("staged") is True, staged
    assert (original / "references" / "a.md").read_text() == "Reviewed content."
    competing = env["ext"] / "display-alias"
    (competing / "references").mkdir(parents=True)
    (competing / "SKILL.md").write_text(SK.format(n="display-alias"))
    (competing / "references" / "a.md").write_text("New owner content.")
    record = env["wa"].get_pending("skills", staged["pending_id"])
    result = json.loads(env["smt"].apply_skill_pending(record["payload"]))
    assert result.get("success") is False, result
    assert "now resolves" in result.get("error", ""), result
    assert (original / "references" / "a.md").read_text() == "Reviewed content."
    assert (competing / "references" / "a.md").read_text() == "New owner content."


@pytest.mark.parametrize("external", [False, True])
def test_global_gate_rejects_bad_create_category_before_staging(env, external):
    from tools.registry import registry
    env["configure"](write_approval=True, external=external)
    result = json.loads(registry.dispatch("skill_manage", {
        "action": "create", "name": "new-skill", "category": 5,
        "content": SK.format(n="new-skill"),
    }))
    assert result.get("success") is False, result
    assert result.get("error") == "Category must be a string.", result
    assert env["wa"].pending_count("skills") == 0
    assert not (env["home"] / "skills" / "new-skill").exists()


@pytest.mark.parametrize("external", [False, True])
def test_batch_can_use_a_newly_created_display_alias(env, external):
    from tools.registry import registry
    env["configure"](external=external)
    result = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "created-skill", "action": "create", "content": SK.format(n="new-alias")},
        {"name": "new-alias", "action": "write_file", "file_path": "references/a.md",
         "file_content": "Created alias support."},
    ]}))
    assert result.get("success") is True, result
    assert (env["home"] / "skills" / "created-skill" / "references" / "a.md").read_text() == "Created alias support."
    assert env["wa"].pending_count("skills") == 0


@pytest.mark.platforms("posix")
@pytest.mark.parametrize("external", [False, True])
def test_batch_ledger_rollback_preserves_a_symlinked_home(env, external):
    from tools import skill_ledger
    from tools.registry import registry
    env["configure"](external=external)
    home = env["home"]
    real_home = home.with_name("real-home")
    home.rename(real_home)
    home.symlink_to(real_home, target_is_directory=True)
    created = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "local-skill", "action": "create", "content": SK.format(n="local-skill")},
    ]}))
    assert created.get("success") is True, created
    skill_md = home / "skills" / "local-skill" / "SKILL.md"
    before = skill_md.read_bytes()
    changed = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "local-skill", "action": "patch", "old_string": "Step 1.", "new_string": "Step changed."},
    ]}))
    assert changed.get("success") is True, changed
    assert b"Step changed." in skill_md.read_bytes()
    ok, message = skill_ledger.rollback_entry(skill_ledger.list_entries("local-skill")[0]["id"])
    assert ok, message
    assert skill_md.read_bytes() == before
    assert home.is_symlink()


def test_failed_batch_restores_local_metadata_without_touching_shared_skill(env):
    from tools.registry import registry
    local = env["home"] / "skills" / "shared-skill"
    local.mkdir()
    original = SK.format(n="shared-skill").replace("Step 1.", "Local instructions.")
    (local / "SKILL.md").write_text(original)
    shared = env["ext"] / "shared-skill"
    shared_before = {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()}
    result = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "shared-skill", "action": "remove_file", "file_path": "SKILL.md"},
        {"name": "shared-skill", "action": "patch", "old_string": "Local instructions.",
         "new_string": "Changed local instructions."},
    ]}))
    assert result.get("success") is False and result.get("failed_index") == 1, result
    assert (local / "SKILL.md").read_text() == original
    assert shared.is_dir()
    assert {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()} == shared_before
    assert not list(env["home"].rglob("*.rollback-broken"))
    assert not list(env["ext"].rglob("*.rollback-broken"))
    assert env["wa"].pending_count("skills") == 0


def test_batch_refuses_newly_unambiguous_alias_outside_its_plan(env):
    from tools.registry import registry
    local = env["home"] / "skills" / "local-y"
    local.mkdir()
    original = SK.format(n="alias-x").replace("Step 1.", "Local instructions.")
    (local / "SKILL.md").write_text(original)
    shared = env["ext"] / "shared-x"
    shared.mkdir()
    (shared / "SKILL.md").write_text(SK.format(n="alias-x"))
    shared_before = {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()}
    assert env["smt"]._find_skill("local-y")["path"] == local
    assert env["smt"]._find_skill("shared-x")["path"] == shared
    assert env["smt"]._find_skill("alias-x") is None
    result = json.loads(registry.dispatch("skill_manage", {"operations": [
        {"name": "local-y", "action": "remove_file", "file_path": "SKILL.md"},
        {"name": "alias-x", "action": "write_file", "file_path": "references/z.md",
         "file_content": "Must not reach the unplanned shared target."},
    ]}))
    assert result.get("success") is False and result.get("failed_index") == 1, result
    assert (local / "SKILL.md").read_text() == original
    assert shared.is_dir() and not (shared / "references" / "z.md").exists()
    assert {p.relative_to(shared): p.read_bytes() for p in shared.rglob("*") if p.is_file()} == shared_before
    assert not list(env["home"].rglob("*.rollback-broken"))
    assert not list(env["ext"].rglob("*.rollback-broken"))
    assert env["wa"].pending_count("skills") == 0
