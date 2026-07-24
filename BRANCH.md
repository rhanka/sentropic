# Feature: LLM egress observability / metering v0 (usage sink + cost ledger)

## Objective
Wire end-to-end LLM egress observability that survives the future gateway topology change:
an app-owned usage/cost sink fed by the already-published `@sentropic/llm-mesh` `onResponse`
hook, persisting to a new `control.cost_ledger`. Observe-only first (record usage/cost);
reserve/settle/refund enforcement is deferred. Ratified anchor: a single app-side settlement
point fed by the mesh hook (which is inside the gateway when it ships), reconciling
ARCH-13 Q2b (app mesh-dispatch) and gateway §5. Design: `spec/SPEC_EVOL_LLM_METERING_OBSERVABILITY.md`.

## Scope / Guardrails
- Scope limited to the app-side metering layer + the mesh-hook wiring + one control migration.
- One migration file max in `api/drizzle/control/*.sql`.
- Make-only workflow, no direct Docker commands. All new text in English.
- Root workspace `~/src/sentropic` reserved for user dev/UAT (`ENV=dev`); must stay stable.
- Isolated worktree `tmp/feat-llm-metering`. Test stack: `ENV=feat-llm-metering`,
  `API_PORT=9350 UI_PORT=5550 MAILDEV_UI_PORT=1250` (verify free before use).
- WP16/mesh-lane coordination: `llm-runtime/index.ts` usage-envelope changes are mesh-lane-adjacent;
  keep them additive and minimal; rebase on origin/main before merge.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `spec/SPEC_EVOL_LLM_METERING_OBSERVABILITY.md`, `spec/DECISION_LLM_EGRESS_STANDARD_PATH.md`
  - `api/src/services/llm-metering/**` (new sink module)
  - `api/src/services/llm-runtime/mesh-dispatch.ts` (wire `hooks:{onResponse}`)
  - `packages/llm-mesh/src/mesh.ts`, `packages/llm-mesh/tests/facade.test.ts`, `packages/llm-mesh/package.json` (BRmet-EX1 only)
  - `api/db/control-schema.ts` (cost_ledger table)
  - `api/tests/**` (metering tests)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`, `docker-compose*.yml`, `.cursor/rules/**`
  - `ui/**`, `packages/**`, `apps/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/control/*.sql` (max 1 migration file)
  - `api/src/services/llm-runtime/index.ts` (usage-envelope plumbing — mesh-lane-adjacent; declare BRmet-EXn if changes go beyond additive usage surfacing)
- **Exception process**: declare `BRmet-EXn` in `## Feedback Loop` (reason, impact, rollback) before touching any conditional/forbidden path.

## Feedback Loop
- BRmet-EX1 — Additive `packages/llm-mesh/**` metadata propagation for `onResponse` hooks. Reason: the published hook does not return request attribution, so the app singleton cannot safely associate a stream completion with its dispatch without AsyncLocalStorage. Impact: backward-compatible public event field plus a patch release of `@sentropic/llm-mesh`; no persistence or secret material crosses the package boundary. Rollback: remove the optional metadata field and app hook wiring; existing callers remain compatible.

## AI Flaky tests
- Standard policy: accept only non-systematic provider/network nondeterminism as flaky; never add timeouts; record signature + user sign-off.
- Observed on PR #441 CI (post-fix run 30099453601), also red on `origin/main` #436 (pre-existing, NOT introduced here — the metering change is additive/observe-only/fail-open):
  - `test-api-unit-integration (ai, …)` ×3 — `api/tests/ai/**` (allowlisted); provider/model nondeterminism.
  - `test-e2e (group-a/b/c/d)` — set fluctuates run-to-run (group-a passed on the prior run, failed on the next) = nondeterministic infra/AI e2e; group-c = `03-chat` (allowlisted).
  - Awaiting owner sign-off to merge over these (rules: AI-flaky non-blocking with signature + sign-off).

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (one coherent app-side increment; single UAT cycle)
- [ ] **Multi-branch**
- Rationale: One reversible increment; conductor delegates lot implementation to Claude sub-agents (Codex unavailable until 2026-07-24) and integrates on one branch.

## Lots
- [x] Lot 0 — Branch + worktree + BRANCH.md + design specs committed
- [x] Lot 1 — `control.cost_ledger` schema + one drizzle migration (observe-only shape: provider/model/usage_raw/input+output tokens/cost_micro_usd nullable/idempotency_key/credential_source/agent_id/created_at)
- [x] Lot 2 — `api/src/services/llm-metering/` observe-only sink + wire `hooks:{onResponse}` into `createLlmMesh` (mesh-dispatch.ts); normalized usage → ledger row
- [x] Lot 3 — usage-envelope plumbing: surface normalized usage on provider paths currently dropping it (as far as additive/safe; flag any path needing mesh-lane coordination)
- [x] Lot 4 — Tests (unit sink + usage-normalizer; run by the CI `unit` suite) + typecheck (API `tsc --noEmit` exit 0, local + CI) + lint; UAT with owner pending. Hook→ledger end-to-end verification is covered by the owner UAT (observe-only, no mockable app-singleton seam) rather than a CI integration test.

## Test plan (file granularity)
- New: `api/tests/unit/llm-metering-sink.test.ts` (sink records a ledger row from a usage event; idempotency by key). 2 tests, green.
- New: `api/tests/unit/llm-metering-usage-normalizer.test.ts` (per-provider usage normalization, stream accumulation, mesh coercion). 13 tests, green.
  - NOTE: placed under `tests/unit/` (not `tests/metering/`) because CI only runs the fixed suite globs (`tests/unit`, `tests/ai`, …); a `tests/metering/` dir would be orphaned/never executed.
- Deferred: hook→ledger integration test — the app mesh singleton has no injection seam for a stubbed provider, so real end-to-end is validated by owner UAT (below), not CI.
- Regression: existing `api/tests/api` chat + `api/tests/ai` must stay green (no behavior change on the live path; sink is additive/observe-only).

## UAT (owner)
- [ ] Run a real generate + a real stream in dev; confirm a `control.cost_ledger` row appears with plausible token counts (`make db-query`).
- [ ] Confirm no regression in chat generation/streaming.
