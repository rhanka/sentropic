# Feature: Product ledger and /gw migration to the cluster gateway module with real budget admission — Lot D B3c

## Objective
- [ ] Deliver Lot D B3c per `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §2 (D2), §5 (D5), §10 row B3c, §12.2, §12.5, §12.6, §12.7 (B0-A4): application budget admission over the 0008 tables, one ledger row per settled request, reservation reaper, pricing single writer, product `/api/v1/gw` on the shared cluster gateway namespace module and the standalone host wired with the same adapters.

## Scope / Guardrails
- [x] Branch `feat/llm-gateway-product-admission`, worktree `tmp/llm-product-admission`, from `origin/main` (B1, B2 + 0008 landed; train mesh 0.22.0 / gateway 0.19.0 / cluster-mesh 0.13.0 published).
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-llm-product-admission` last; never `ENV=dev` or `clean-all`.
- [x] Ports on every make that starts services: API `9471`, UI `5671`, Maildev UI `1571`; `REGISTRY=local` for image targets.
- [x] Disposable Postgres of `ENV=test-llm-product-admission` only; NO migration in this lot (stop and report if one is needed).
- [x] Selective staging and separate `make commit`; checkboxes updated in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/llm-metering/budget-admission.ts` (new, BRDP-EX9)
  - `api/src/services/llm-metering/route-settlement.ts` (new, BRDP-EX9)
  - `api/src/services/llm-metering/reservation-reaper.ts` (new, BRDP-EX9)
  - `api/src/services/llm-metering/model-pricing-writer.ts` (new, BRDP-EX9)
  - `api/src/services/llm-metering/cost-ledger-sink.ts`, `api/src/services/llm-metering/index.ts` (evolve, BRDP-EX9)
  - `api/src/routes/namespaces/gw.ts` (BRDP-EX9)
  - `api/src/services/llm-runtime/gateway-route-plane.ts` (BRDP-EX9, only if wiring requires)
  - `api/src/app.ts` (BRDP-EX9, only if the `/gw` registry entry changes)
  - `api/package.json` (`@sentropic/llm-gateway` `^0.19.0`, BRDP-EX9) and root `package-lock.json` through `make lock-root` (BRDP-EX6)
  - `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` (the `file:../packages/llm-gateway` line and the B3c status only)
  - `api/tests/api/llm-budget-ledger.test.ts` (new), `api/tests/unit/llm-metering-sink.test.ts`, `api/tests/api/cluster-mesh-gw.test.ts`
  - `apps/llm-gateway/src/app.ts`, `apps/llm-gateway/src/readiness.ts`, `apps/llm-gateway/src/lifecycle.ts`, `apps/llm-gateway/tests/*.test.ts`, `apps/llm-gateway/tests/fixtures.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - `packages/**`
  - `api/drizzle/**`
  - `api/src/db/**`
  - `api/Dockerfile`
  - cutover dispatch-generation logic
  - any path not listed in Allowed Paths
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none beyond BRDP-EX6 / BRDP-EX9 (already listed above)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `acknowledge`: BRDP-EX9 (conductor-approved) — reason: product lane migrates `gw.ts` onto the cluster gateway namespace module with real admission, D2 partition rejection, settlement and readiness, and adds the application ledger adapters; `api/package.json` gains `@sentropic/llm-gateway` `^0.19.0` (workspace link, not `file:`) so product code stops importing gateway source by relative path; impact: product `/gw` requires an active cutover record, a verified partition revision, a tenant strategy, pricing and a tenant bucket before any dispatch; no dispatch-generation change; rollback: restore prior `gw.ts` and dependency, ledger rows preserved, product author fence unchanged.
- `acknowledge`: BRDP-EX6 (conductor-approved) — reason: root `package-lock.json` refreshed through `make lock-root` for the new api dependency only; impact: lockfile-gated CI jobs run; rollback: revert the manifest and lockfile hunks.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (default for orthogonal tasks; single final test cycle)
- [ ] **Multi-branch** (only if sub-workstreams require independent CI or long-running validation)
- Rationale: one builder, one product/ledger lane; the conductor integrates after independent review.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI change in this lot; no browser UAT (spec §10: no web/Chrome/VSCode feature change).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, spec §2, §5, §10, §12.
  - [x] Confirm worktree/branch and command style `make ... API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-product-admission`.
  - [x] Validate scope boundaries and record BRDP-EX6 / BRDP-EX9.

- [ ] **Lot 1 — Application ledger adapters**
  - [ ] `model-pricing-writer.ts`: B0-A4 protocol verbatim (advisory xact lock, predecessor `FOR UPDATE`, overlap check, unique key backstop).
  - [ ] `budget-admission.ts`: tenant strategy, pricing (max over effort variants, codex at model max output, input margin), atomic multi-bucket reservation, blocked attempts, durable dispatch marker, idempotent release, D2 partition guard, catalog quote seam, store probe.
  - [ ] `route-settlement.ts`: one `cost_ledger` row per settled request, hold settle/release, overrun audit, allowlisted `attempts`, opaque `principal_key`, settlement outbox event, ledger probe.
  - [ ] `reservation-reaper.ts`: expire holds past deadline (release never-dispatched, reconcile dispatched), idempotent and concurrency safe.
  - [ ] `cost-ledger-sink.ts` / `index.ts`: observe-only sink kept for non-gateway API calls; barrel exports; gateway settlement never wires `recordLlmUsage`.

- [ ] **Lot 2 — Product `/gw` and host wiring**
  - [ ] `api/package.json` `@sentropic/llm-gateway` `^0.19.0` + `make lock-root`; product code imports no gateway source by relative path.
  - [ ] `gw.ts` on `createGatewayNamespaceModule` (one mount) with budget, B2 identity, partition, settlement, readiness; remove `stubGatewayConfig`, noop `settleRoute()`, boot/request-time cutover activation; keep the author fence.
  - [ ] `apps/llm-gateway/src/app.ts` budget slot + identity, `readiness.ts` store probes, `lifecycle.ts` B1 minors.

- [ ] **Lot 3 — Tests and gates**
  - [ ] `api/tests/api/llm-budget-ledger.test.ts` (new, real Postgres).
  - [ ] `api/tests/unit/llm-metering-sink.test.ts` (update).
  - [ ] `api/tests/api/cluster-mesh-gw.test.ts` (update).
  - [ ] `apps/llm-gateway/tests/*.test.ts` (update for the budget slot).
  - [ ] Lot gate:
    - [ ] `make typecheck-api lint-api API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-product-admission`
    - [ ] Scoped runs per new/changed test file with `SCOPE`.
    - [ ] `make test-api-unit` + `make test-api-endpoints` (ports, ENV last).
    - [ ] `make typecheck-llm-gateway-process lint-llm-gateway-process test-llm-gateway-process` (ports, ENV last).
    - [ ] `make build-api REGISTRY=local` (ports, ENV last).
    - [ ] `make scope-check`, `make down` + `make ps` (ports, ENV last).

- [ ] **Lot N-1 — Docs consolidation**
  - [ ] Spec: the `file:../packages/llm-gateway` line and the B3c status.

- [ ] **Lot N — Final validation**
  - [ ] Conductor: independent review, PR from `BRANCH.md`, CI, then removal of `BRANCH.md` before merge.
