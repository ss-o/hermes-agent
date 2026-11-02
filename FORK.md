# Maintained fork: `ss`

Keep useful fixes available while upstream PRs are pending, and continue taking
upstream updates. `ss` is the downstream integration branch; upstream `main`
stays the base. Keep this file on `ss`, outside upstream PRs.

## Status and patch ledger

Checked 2026-11-02. Base: `NousResearch/hermes-agent` at `e8639fd431`.
This is a pilot, not yet the live installation. Existing local skill-gate
repairs and the separate TUI overlay have not been migrated or qualified here.

| Change | On `ss` | Upstream status | Next action |
| --- | --- | --- | --- |
| Kernel state across terminal `cd`, plus terminal RPC refusal shape | Yes, including missing-directory refusal and failed-restoration handling | [#123740](https://github.com/NousResearch/hermes-agent/pull/123740) open; its head lacks the later corrections | Refresh the focused PR from the verified fix, excluding this file |
| Untrust a vanished project directory | No | [#123127](https://github.com/NousResearch/hermes-agent/pull/123127) open | Recheck on current upstream before deciding to carry it |

Each carried fix needs a small commit, regression coverage, and a row here.
Use separate topic branches based on upstream for submissions; do not submit
the accumulated `ss` branch. Upstream acceptance is useful, not a prerequisite
for using a reviewed fix in the fork.

## Update procedure

Use a clean, disposable candidate checkout, never an update directly inside
the running installation. For a new clone:

```sh
git clone --branch ss git@github.com:ss-o/hermes-agent.git hermes-fork
cd hermes-fork
git remote add upstream https://github.com/NousResearch/hermes-agent.git
git fetch upstream main
git switch -c update origin/ss
git merge --no-ff --no-commit upstream/main
```

1. Stop on conflicts or failing checks; retain the last working `ss`. Abort an unresolved merge with `git merge --abort`. Never reset `ss` to upstream or force-push it.
2. Follow `CONTRIBUTING.md` to build a fresh PM test environment with an isolated `HERMES_HOME`. Run `scripts/run_tests.sh` for the carried fixes and affected callers, then `python scripts/check --base upstream/main`. Review the combined diff before making the signed merge commit, when a merge is pending.
3. Refresh this ledger: upstream base, verification, PR states, conflicts and next action. Commit signed. Obtain review of the final candidate, then publish with `git push origin HEAD:ss` only if it fast-forwards the published branch. A rejection means refresh and review again.
4. Promote the verified revision to an installation separately, with its previous revision retained for rollback. Do not assume plain `hermes update` preserves this branch: stable/tag updates can bypass custom-branch handling. Qualify the installed updater's branch/channel policy first.

Check PR status at every update, not on a timer. If upstream implements a fix,
verify equivalent behavior and remove only the redundant downstream change.
When no carried fixes remain, verify a clean upstream installation and retire
the fork maintenance path. A rejected PR requires a fresh decision on whether
the fix's value justifies its ongoing upkeep.

## Next checkpoint

- Upstream reached `6ab0de91d8` (444 commits beyond this pilot's base) at the latest check. Merge and qualify current upstream in the next candidate before live adoption.
- Verified: one real upstream desktop increment merges while preserving the fork patch tree. Cwd/RPC, execution-mode and process-cleanup tests pass on Linux; this does not qualify a live updater or Windows/macOS behavior.
- Refresh #123740, then assess #123127 and the existing installation patches before proposing live adoption.
- Keep private host details and raw validation receipts in the workspace task handoff; this file is the portable maintenance record.
