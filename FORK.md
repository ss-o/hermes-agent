# Maintained fork: `ss`

Keep useful fixes available while upstream PRs are pending, and continue taking
upstream updates. `ss` is the downstream integration branch; upstream `main`
stays the base. Keep this file on `ss`, outside upstream PRs.

## Status and patch ledger

Candidate refreshed 2026-11-04. Base: `NousResearch/hermes-agent` at `71736c9f32`.
The candidate carries the existing skill-gate and TUI patches in source, rather
than depending on a separate renderer overlay. Publication does not activate
the fork in an existing installation. Live adoption and restarts remain separate gates.

| Change | On `ss` | Upstream status | Next action |
| --- | --- | --- | --- |
| Kernel state across terminal `cd`, plus terminal RPC refusal shape | Yes, including missing-directory refusal and failed-restoration handling | [#123740](https://github.com/NousResearch/hermes-agent/pull/123740) open; its head lacks the later corrections | Refresh the focused PR from the verified fix, excluding this file |
| Externally owned skill-write approval and batch target binding | Candidate preserves the local repairs, including alias and ledger binding | Downstream carry | Run external-write and affected skill/batch regression coverage on each refresh |
| Full-file skill rewrite review | Preview, summary and ordered batch folding recognize the advertised `patch` plus `content` shape and share approval's patch-shape validation | Downstream carry | Verify real staged diff/approval parity, invalid-shape refusal and unchanged target binding |
| Legacy batch default-name approval | Both write gates stage each operation's resolved name, preserving explicit per-operation overrides and ordered replay | Downstream carry | Verify staged preview and approval through global and external-only gates |
| Slash aliases resolve but stay out of help and completion | Candidate preserves the local repair | Downstream carry | Keep CLI, gateway and TUI behavior consistent |
| TUI cold-start theme, composer status, mouse hover and useful status line | Candidate incorporates all six overlay patches, regenerates the locale key index and documents the CLI/TUI status-field differences | Downstream carry | Run the full TUI check and build; retire the old overlay only during separately approved adoption |
| Fork source-update target | Candidate maps the `main` source channel, passive checks and banner baseline to `origin/ss` only for `ss-o/hermes-agent` | Fork-specific policy, not an upstream submission | Keep real Git check/apply, passive-check, missing-ref, cache and repository-isolation coverage |
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
4. Promote the verified revision to an installation separately, only with explicit activation and service-restart authorization. Keep its previous revision, launcher and runtime selection for rollback. Follow the adoption gates below; never qualify against the live profile.

Check PR status at every update, not on a timer. If upstream implements a fix,
verify equivalent behavior and remove only the redundant downstream change.
When no carried fixes remain, verify a clean upstream installation and retire
the fork maintenance path. A rejected PR requires a fresh decision on whether
the fix's value justifies its ongoing upkeep.

## Delivery and adoption gates

The fork's default source channel is named `main`, as upstream defines it,
but its target is `ss`. Both `hermes update --check` and plain `hermes update`
resolve that target from this fork's `origin`. They do not merge upstream
`main` into the running install. Maintainers integrate upstream through the
candidate procedure above, then publish only the qualified `ss` revision.
Official installs and other forks retain their existing branch/channel policy.
An explicit `--branch` still wins. A missing `ss` stops the check or update;
it must not silently fall back to `main`.

Passive checks use the same delivery default even on another checked-out branch,
without switching that checkout. Explicit passive branch choices, including the
Desktop branch setting, retain priority; an unavailable branch on this fork is
reported, not silently re-pinned to `main`. The banner compares with `origin/ss`,
so a stale or absent upstream-mirror ref cannot inflate its carried-commit count.

The managed-Git contract applies to this update-comparison state. The unchanged
upstream release-tag and release-channel title helpers still use Git from PATH;
when only PM-managed Git is available off PATH, those optional release metadata
fields can be omitted without aborting startup. This is a documented existing
limitation, not a claim that all banner metadata uses the updater's executable.

Before activation:

1. Verify the published signed head equals the tested and independently reviewed candidate. Retain the original installation revision and clean/dirty state without overwriting local work.
2. Use an isolated Hermes home to verify the candidate's CLI, updater target, Python environment and built TUI. Confirm the existing profile's state is compatible; preserve the supported state backup before an approved live change. Code rollback is not database downgrade support.
3. Bind the installation's `origin` to this fork, ensure its fetch rules include `ss` (an existing single-branch clone may fetch only `main`), select the `ss` checkout, and ensure its per-install source channel is `main`, not an older persisted release subscription. A remote change alone does not fetch `ss` or clear a saved stable/canary channel. Do not rely on `parked_branch_strategy` to override release-tag selection.
4. Replace the old local TUI adapter with the normal installation launcher as part of the same approved promotion. Its patches are now in `ss`; replaying them onto already-patched sources can fail and show the old fallback warning. Keep the adapter and its activation record for rollback, but do not run its rebuild against the promoted fork.
5. Drain and restart only the services owned by the promoted installation, then verify the running backend revision, selected Python runtime and renderer artifact. Existing TUI processes do not switch bundles in place.
6. On a failed promotion, stop and use the retained compatible revision/runtime/launcher and state recovery procedure. Never force a database written by newer code into an incompatible older release.

Linux qualification covers the carried regressions, actual disposable Git
check/apply transitions, explicit-branch precedence and missing-target refusal.
The completion/service layer in those Git tests is replaced by an observation
boundary: they are not evidence of a live service rollout. Native Windows/macOS,
a live remote backend, conflict resolution and the full Python suite remain
outside this qualification. Exact check outputs, review receipts and host-specific
rollback details belong in the retained workspace task handoff, not this file.

## Remaining work

- For every refresh, require the candidate's regression, native-check and independent-review gates before signed publication. Failed checks retain the last published revision; do not weaken checks to promote it.
- Obtain separate approval for live adoption and its drain/restart window. No existing installation changes merely because `ss` is published.
- Refresh #123740 only under its own publication authorization, then assess #123127 without silently adding it to this fork.
- At each refresh, recheck upstream PR states and whether equivalent upstream fixes make a downstream patch redundant.
