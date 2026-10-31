"""Target ownership and base-state binding for staged ``skill_manage`` writes.

``skills.external_write_approval`` stages only writes whose target lives in an externally owned
skill root (``skills.external_dirs`` or a trusted project's skills dir), so profile-local learning
stays free while shared sources get a review step. A write it stages records where each target
resolved, and for whole-file replacements what the file held; approval replays it only while that
still holds, so an approval never lands on a different root or overwrites content changed after
review. Targeted patches are anchored by the matcher at replay and bind only their location. Facade
state (``_find_skill``, ``_resolve_skill_dir``, ``_validate_file_path``) is reached lazily through
``tools.skill_manager_tool``.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
import hashlib
import os
from pathlib import Path
from typing import Any, Optional

_SKILL_MD = "SKILL.md"
_WHOLE_FILE_ACTIONS = {"create", "edit", "write_file", "remove_file", "delete"}
_batch_paths: ContextVar[Optional[dict[str, tuple[Optional[Path], bool]]]] = ContextVar(
    "skill_batch_paths", default=None)


def bound_skill(name: str) -> tuple[bool, Optional[dict[str, Any]]]:
    """Keep a batch name on its planned target even if an earlier op removes its SKILL.md."""
    paths = _batch_paths.get()
    if paths is None or name not in paths:
        return False, None
    path, existed = paths[name]
    if path is None:
        # An earlier op may introduce a display alias. Discover it normally, but only
        # accept a directory already covered by this batch's snapshot and gate plan.
        from tools import skill_manager_tool as _smt
        token = _batch_paths.set(None)
        try:
            discovered = _smt._find_skill(name)
        finally:
            _batch_paths.reset(token)
        if discovered:
            path = next((planned for planned, _ in paths.values() if planned is not None
                         and _resolve(planned) == _resolve(discovered["path"])), None)
    found = path is not None and (existed or (path / _SKILL_MD).is_file())
    return True, {"path": path} if found else None


@contextmanager
def batch_target_scope(ops: list[dict[str, Any]]):
    """With the external gate enabled, execute every name against its initial target plan."""
    from tools.write_approval import external_write_approval_enabled
    if not external_write_approval_enabled():
        yield
        return
    paths = {target["name"]: (target["dir"], target["found"]) for target in op_targets(ops)}
    token = _batch_paths.set(paths)
    try:
        yield
    finally:
        _batch_paths.reset(token)


def _resolve(path: Path) -> Path:
    try:
        return path.expanduser().resolve()
    except (OSError, RuntimeError):
        return path.expanduser().absolute()


def _file_label(op: dict[str, Any]) -> Optional[str]:
    """The file an op writes inside its skill dir: None = the whole skill (delete); "" = an invalid
    supporting path (the op fails on its own, so there is nothing to inspect or bind)."""
    from tools import skill_manager_tool as _smt
    action = op.get("action")
    if action == "delete":
        return None
    if action in {"create", "edit"} or (action == "patch" and op.get("content")):
        return _SKILL_MD
    label = op.get("file_path") or _SKILL_MD
    return "" if label != _SKILL_MD and _smt._validate_file_path(label) else label


def _whole_file(op: dict[str, Any]) -> bool:
    return op.get("action") in _WHOLE_FILE_ACTIONS or (op.get("action") == "patch" and bool(op.get("content")))


def op_targets(ops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """``[{name, dir, file, found, create, category, whole}]`` per op. ``dir`` is None when the
    skill does not exist and the op is not a create; a later op on a skill an earlier create in
    the same batch makes targets that create's dir."""
    from tools import skill_manager_tool as _smt
    created: dict[str, Path] = {}
    targets = []
    for op in ops:
        name = op.get("name") or ""
        found = _smt._find_skill(name) if name else None
        is_create = not found and op.get("action") == "create"
        if found:
            skill_dir: Optional[Path] = Path(found["path"])
        elif is_create:
            skill_dir = created[name] = _smt._resolve_skill_dir(name, op.get("category"))
        else:
            skill_dir = created.get(name)
        targets.append({"name": name, "dir": skill_dir, "file": _file_label(op), "found": bool(found),
                        "create": is_create, "category": op.get("category"), "whole": _whole_file(op)})
    return targets


def _target_external(target: dict[str, Any]) -> bool:
    """Whether one target lives in an externally owned skill root, judged on the skill dir and on
    the file it writes (a profile-local SKILL.md may link into a shared root)."""
    from agent.skill_utils import is_external_skill_path
    if target["dir"] is None:
        return False
    return is_external_skill_path(target["dir"]) or bool(
        target["file"] and is_external_skill_path(target["dir"] / target["file"]))


def targets_external(ops: list[dict[str, Any]]) -> bool:
    """True when any op writes into an externally owned skill root. Raises when ownership cannot be
    determined; the caller treats that as external (fail closed)."""
    return any(_target_external(target) for target in op_targets(ops))


def _external_or_unknown(target: dict[str, Any]) -> bool:
    try:
        return _target_external(target)
    except Exception:  # health: allow BLE001 -- unknown ownership binds content too (the stricter choice)
        return True


def _sha256_file(path: Path) -> Optional[str]:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def _tree_digest(skill_dir: Path) -> Optional[str]:
    if not skill_dir.is_dir():
        return None
    digest = hashlib.sha256()
    for path in sorted(p for p in skill_dir.rglob("*") if p.is_file()):
        digest.update(os.fsencode(path.relative_to(skill_dir)) + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def _state(skill_dir: Path, file_label: Optional[str]) -> Optional[str]:
    return _tree_digest(skill_dir) if file_label is None else _sha256_file(skill_dir / file_label)


def capture_binding(ops: list[dict[str, Any]]) -> dict[str, Any]:
    """Pre-write location of every target, plus the content of each external (skill, file) a
    whole-file op replaces; local targets bind location only. Raises OSError/ValueError when a
    target cannot be read."""
    entries: dict[tuple, dict[str, Any]] = {}
    for target in op_targets(ops):
        name = target["name"]
        if target["dir"] is None:
            entries.setdefault(("missing", name), {"name": name, "kind": "missing"})
            continue
        skill_dir = _resolve(target["dir"])
        if target["create"]:
            entries.setdefault(("create", name), {"name": name, "kind": "create", "dir": str(skill_dir),
                                                  "category": target["category"]})
            continue
        if not target["found"] or target["file"] == "":
            continue  # inside a skill this batch creates (covered by its create entry), or an invalid path
        key = ("existing", name, str(skill_dir), target["file"])
        entry = entries.setdefault(key, {
            "name": name, "kind": "existing", "dir": str(skill_dir), "file": target["file"],
            "file_real": str(_resolve(skill_dir / target["file"])) if target["file"] else None})
        if target["whole"] and "sha256" not in entry and _external_or_unknown(target):
            entry["sha256"] = _state(skill_dir, target["file"])
    names = list(dict.fromkeys(op.get("name") or "" for op in ops))
    return {"version": 1, "names": names, "targets": list(entries.values())}


def binding_names(binding: Any) -> list[str]:
    """Every skill name the staged ops use, for the replay's locks (aliases of one skill included)."""
    binding = binding or {}
    return binding.get("names") or [entry["name"] for entry in binding.get("targets", ())]


def _check_entry(entry: dict[str, Any]) -> Optional[str]:
    from tools import skill_manager_tool as _smt
    name, found = entry["name"], _smt._find_skill(entry["name"])
    if entry["kind"] == "missing":
        return f"skill '{name}' appeared at {found['path']} after this write was staged" if found else None
    bound_dir = Path(entry["dir"])
    if entry["kind"] == "create":
        if found:
            return f"skill '{name}' was created at {found['path']} after this write was staged"
        destination = _resolve(_smt._resolve_skill_dir(name, entry.get("category")))
        if destination != bound_dir:
            return f"a new skill '{name}' would now be created at {destination}, not the reviewed {bound_dir}"
        return None
    if not found or _resolve(Path(found["path"])) != bound_dir:
        where = _resolve(Path(found["path"])) if found else "nowhere"
        return f"skill '{name}' now resolves to {where}, not the reviewed {bound_dir}"
    if entry["file"] and str(_resolve(bound_dir / entry["file"])) != entry["file_real"]:
        return f"{entry['file']} of skill '{name}' now points somewhere other than the reviewed file"
    if "sha256" in entry and _state(bound_dir, entry["file"]) != entry["sha256"]:
        return f"{entry['file'] or 'skill directory'} of skill '{name}' changed after this write was staged"
    return None


def check_binding(binding: Any) -> Optional[str]:
    """None when every bound target still holds, else why the staged write must not replay. A
    record without a binding (the global gate, or staged before binding existed) replays as before."""
    for entry in (binding or {}).get("targets", ()):
        if (reason := _check_entry(entry)) is not None:
            return reason
    return None
