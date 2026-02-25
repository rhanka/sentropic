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

- **BR13-EX2** (approved, 2026-02-24)
  Path: `spec/**`, `PLAN.md` (`Conditional Paths` override for BR-13).
  Reason: close Lot N-1 by consolidating Chrome plugin download-distribution behavior into long-lived specs and by updating roadmap branch status/dependencies.
  Impact: documentation-only updates for branch traceability and merge readiness.
  Rollback: revert BR-13 documentation consolidation commit.

- **BR01-EX1** (resolved, 2026-02-23)
  Path: `docker-compose.yml` (`Forbidden Paths` override for BR-01).
  Reason: pass `GEMINI_API_KEY` into the API container so BR-01 Gemini runtime can use branch/root `.env` credentials in test/dev envs.
  Impact: compose environment wiring only (`api` service), no app logic change.
  Rollback: remove `GEMINI_API_KEY=${GEMINI_API_KEY}` from `api.environment`.

- **BR01-EX2** (resolved, 2026-02-24)
  Path: `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`, `PLAN.md` (`Conditional Paths` override for BR-01 docs consolidation).
  Reason: close BR-01 Lot N-1 by consolidating provider-runtime branch learnings and integration readiness status.
  Impact: documentation-only updates to roadmap/spec traceability, no product/runtime behavior change.
  Rollback: revert the BR-01 closure notes added to the spec and roadmap plan.

- **BR01-EX3** (resolved, 2026-02-24)
  Path: `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md`, `BRANCH.md` (`Conditional Paths` override for BR-01 follow-up planning update).
  Reason: document and gate the BR-01 scope increment (user-scoped defaults + `/folder/new` model selection) before implementation.
  Impact: documentation-only updates; no runtime or infrastructure change.
  Rollback: revert BR-01 follow-up planning notes from `spec/SPEC_EVOL_MODEL_AUTH_PROVIDERS.md` and `BRANCH.md`.

- **BR01-EX4** (resolved, 2026-02-25)
  Path: `.github/workflows/ci.yml` (`Conditional Paths` override for BR-01 CI credential parity).
  Reason: inject `GEMINI_API_KEY` in the same CI jobs/scopes where `OPENAI_API_KEY` is already injected.
  Impact: CI env wiring only; no runtime/app behavior change.
  Rollback: remove `GEMINI_API_KEY` workflow env lines added alongside `OPENAI_API_KEY`.

- **BR01-EX5** (resolved, 2026-02-25)
  Path: `.github/workflows/ci.yml` (`Conditional Paths` override for BR-01 CI matrix adjustment).
  Reason: shard `test-api-unit-integration` `endpoints` suite into four shards to reduce suite contention and stabilize CI runtime.
  Impact: CI-only change; no runtime/app behavior change.
  Rollback: revert commit `cd73ea8` to restore the previous non-sharded endpoints matrix entry.

- **BR01-EX6** (resolved, 2026-02-25)
  Path: `.github/workflows/ci.yml`, `e2e/tests/03-chat.spec.ts`, `e2e/tests/08-chat-heavy.spec.ts`, `e2e/tests/08-documents-summary.spec.ts` (`Conditional Paths` override for BR-01 E2E rebalance).
  Reason: split heavy `03`/`04` E2E flows into dedicated `08-*` specs and add a 4th E2E matrix group to reduce critical-path tail duration.
  Impact: CI/test-organization only; no runtime/app behavior change.
  Rollback: move the heavy viewer chat flow back to `03-chat.spec.ts`, rename `08-documents-summary.spec.ts` back to `04-documents-summary.spec.ts`, and restore the prior 3-group E2E matrix in `.github/workflows/ci.yml`.
