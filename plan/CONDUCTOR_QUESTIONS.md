# Conductor Decision Board

Status date: 2026-02-22
Execution rule: resolve only decisions that block the active lot/wave. Non-blocking design questions are deferred to the owning branch implementation lot.

## BR-00 `feat/roadmap-stabilization`

1. **BR00-D1 Parity rule** (priority: high, resolved)
Decision: `main` is the default behavioral baseline.
Exception: keep a divergent behavior only if it is explicitly intended by a merged branch/spec and documented in BR-00 notes.

2. **BR00-D2 Minimatch CVE handling** (priority: high, partially resolved)
Decision: no technical fix in BR-00 (mitigation planning only).
Done: backlog item added for `eslint` upgrade in `TODO.md`.
Planning decision (2026-02-22):
- owner: conductor
- target branch: `feat/release-ui-npm-and-pretest` (BR-07)
- due date: 2026-03-01

3. **BR00-D3 CI/UAT scope to unblock W1** (priority: medium, resolved)
Decision:
- If BR-00 changes no runtime code (`api/**`, `ui/**`, `e2e/**`), do not re-run full gates; attach proof (`git diff --name-only`) + latest green CI reference.
- If runtime code changes, run full Lot 1/Lot 2 gates from BR-00 plan.

4. **BR00-D4 QL-1 decisions needed for W1** (priority: high, partially resolved)

- **MPA-Q1** Model ID naming/versioning policy in UI
  Decision (2026-02-22): keep provider-native model IDs, always paired with `provider_id` in API/UI payloads.
  Implementation note: for labels, reuse/extend the current app model mapping conventions.

- **MPA-Q2** SSO linking policy
  Decision (2026-02-22): explicit linking only (no automatic email auto-link).

- **MPA-Q3** Workspace provider allow/deny policy
  Decision (2026-02-22): out of W1 scope (`no` for now), revisit after W1.

- **AWT-Q1** Minimum W1 status taxonomy
  Decision (2026-02-22): Option A.
  Options:
  - A: `todo`, `in_progress`, `blocked`, `done`, `cancelled`
  - B: A + `review`
  Recommended: A.

- **AWT-Q2** Critical actions requiring approval
  Decision (2026-02-22): use the minimum W1 list below.
  - publish/release actions (npm/chrome/vscode),
  - destructive data actions,
  - auth/permission changes,
  - out-of-sandbox/escalated commands.

- **AWT-Q5** Steering profile ownership
  Decision (2026-02-22): Option A (provisional validation).
  Options:
  - A: workspace admin defines policy; user can only reduce autonomy in session.
  - B: each user session can choose policy freely.
  Recommended: A.

5. **BR00-D5 Workspace isolation** (resolved)
Resolved on 2026-02-22: owner is conductor (Codex) and `tmp/feat-roadmap-stabilization` is created/configured.

## Scope Exceptions

- **BR00-EX1** (resolved, 2026-02-22)
  Path: `.cursor/rules/workflow.mdc` (`Forbidden Paths` override for BR-00).
  Reason: standardize tmp setup on `git worktree` to avoid isolated clone drift and simplify conductor orchestration.
  Impact: documentation/process only, no product/runtime change.
  Rollback: revert the `Tmp workspace setup` section to previous clone-based instructions.
