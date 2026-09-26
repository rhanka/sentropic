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
  - `api/vitest.config.ts` (one alias line, BRDP-EX13 approved, see Feedback Loop)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `acknowledge`: BRDP-EX9 (conductor-approved) — reason: product lane migrates `gw.ts` onto the cluster gateway namespace module with real admission, D2 partition rejection, settlement and readiness, and adds the application ledger adapters; `api/package.json` gains `@sentropic/llm-gateway` `^0.19.0` (workspace link, not `file:`) so product code stops importing gateway source by relative path; impact: product `/gw` requires an active cutover record, a verified partition revision, a tenant strategy, pricing and a tenant bucket before any dispatch; no dispatch-generation change; rollback: restore prior `gw.ts` and dependency, ledger rows preserved, product author fence unchanged.
- `acknowledge`: BRDP-EX6 (conductor-approved) — reason: root `package-lock.json` refreshed through `make lock-root` for the new api dependency only; impact: lockfile-gated CI jobs run; rollback: revert the manifest and lockfile hunks.
- `acknowledge`: BRDP-EX13 (conductor-approved in fix round 1) — `api/vitest.config.ts` one alias line `@sentropic/cluster-mesh/compose/gateway` → package source; reason: the existing `@sentropic/cluster-mesh` alias prefix-matches the subpath and breaks every API test importing `gw.ts` (the product must use the SAME `createGatewayNamespaceModule` as the host); impact: test resolution only, no runtime/build change; rollback: remove the line.
- `attention`: D2 partition guard and the catalog quote seam live in `budget-admission.ts` (listed file) instead of a new module; both hosts wrap caller auth: unassigned or other-host identity → 401 (chat and `/v1/models`) before budget/account; missing, overlapping, revision or hash mismatch → 503 and not ready.
- `attention`: product partition source = trusted env `LLM_GATEWAY_PARTITION` (JSON revision, hash, assignments) pinned by the active `/gw` cutover evidence `shadowComparison.partition` (revision id and hash only; prior pair in `rollbackCheckpoint.partition`); the operator writes that evidence, neither host writes cutovers.
- `attention`: product `/gw` no longer self-activates its cutover (author fence kept, read-only). With no active `/gw` row for the running generation every `/gw` path answers `503 wrong_author`. On tiers where `main` already auto-activated `/gw` (constant generation `cluster-mesh-session-v1`, no partition evidence): `/healthz` 200, `/readyz` 503, unauthenticated 401, authenticated 503, no provider call. Activation order in spec §12.8: reaper scheduled first (activation forbidden before), then partition provisioning and evidence, then the operator cutover.
- `attention`: product quote = the catalog entries of the exact requested model, one attempt; an unknown model is a quote refusal (503) and a planned target outside the quote (alias/default fallback) is `quote-mismatch` (503, hold released); conservative: no unreserved candidate.
- `attention`: product caller = B2 `resolveSessionPrincipal` over the verified session (memberships, tenant status); a user with several eligible workspaces is refused (401) since no trusted workspace selection exists; any service identity is refused on the product path.
- `attention`: gateway module preparation failure on the product maps every `/gw` path to 503 (`gateway_module_unavailable`) instead of failing the whole API boot.
- `attention`: liability = `maxAttempts × max(candidate)`; candidate = input × (1 + 25 % margin) at the input rate + output allowance at max(output, reasoning) rate (max over effort variants) + image/tool units, floored by `min_charge`; codex-like candidates reserve max(allowance, model max output, default 128000); holds expire after 30 min; product default output ceiling 4096; required bucket = tenant scope, workspace/principal/model buckets applied when present; monthly buckets roll over at `reset_at`.
- `attention`: `principal_key` = verified opaque principal id (user id or `service:<client>`, id-shaped only); any other value (`@`, dot, colon, space) refuses admission (503), so no e-mail, hostname or IP can be stored.
- `attention`: the ledger `operation` (generate|stream) is carried by a trusted internal header set by middleware (client value discarded) and bound to the verified cost object.
- `deferred`: reaper scheduling — `reapExpiredHolds` is implemented and tested, but no allowed path schedules it (product sweep scheduler and host `index.ts` are outside scope); follow-up lot, owner: conductor; `/gw` activation is FORBIDDEN before it (spec §12.8).
- `acknowledge`: fix round 1 (muse approve-with-fixes + complementary review), one line per finding:
  - F1 HIGH deadlock — fixed: `lockBudgets` (`SELECT … ORDER BY id FOR UPDATE`) before every bucket UPDATE in admission, settlement, release and reaper; reaper runs one transaction per hold; concurrency test over tenant + workspace + model buckets (ids inserted in reverse order); mutation check: with `lockBudgets` disabled (old ordering) the test failed 3 of 3 runs with Postgres `deadlock detected` (40P01), with the fix it passed 3 of 3 runs plus the full file.
  - F2 HIGH codex detection — fixed: `mayUseUnenforcedTransport` mirrors llm-mesh `route-quote.ts` (pinned transport, else provider account transports; `openai` has `codex`); tested at model max output.
  - F3 HIGH reasoning at settlement — fixed: `SettleUsage` carries input/output only (reasoning folded into output), so settled output is billed at max(output, reasoning) rate like the reservation; image/tool units billed when present; unit + Postgres tests.
  - F4 costliest fallback — fixed: ranked by `priceWeight` (input + max(output, reasoning) + image + tool + min charge).
  - F5 workspace-less caller — fixed: refused as audited `missing_bucket` when the tenant has any workspace bucket; tested.
  - F6 empty quote / bad maxAttempts — documented exception: the gateway never admits an empty quote, mesh bounds maxAttempts 1..8, and the 0008 reason CHECK has no code for it (a new code needs a migration); guard now runs first and writes no row.
  - F7 settlement mode on cost identity — verified: gateway 0.19 passes the verified cost object unchanged to `settleRoute` (JSON and SSE product tests assert `operation = 'stream'` end to end); kept.
  - F8 late correction overrun — fixed: the reaper-pending correction also writes the `overrun` audit; tested.
  - F9 request id collision — fixed: a hold-less row with the request id is adopted as the settlement row; a row of another hold is kept and this hold still settles with its full charge; the reaper charges the liability unless the row belongs to its own hold; tested.
  - F10 principal shapes — fixed: `principal_key` accepts only `[A-Za-z0-9][A-Za-z0-9_-]*` or `service:` + that shape (no hostname, e-mail, IP).
  - Decisions recorded in spec §12.8: product `/gw` session-only (S2S refused, v0), gateway `instanceof RouteQuoteError` fix belongs to the mesh/gateway lane (neutralized by the single workspace mesh copy).

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
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/subagents.md`, `rules/testing.md`, `plan/BRANCH_TEMPLATE.md`, spec §2, §5, §10, §12.
  - [x] Confirm worktree/branch and command style `make ... API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-product-admission`.
  - [x] Validate scope boundaries and record BRDP-EX6 / BRDP-EX9.

- [x] **Lot 1 — Application ledger adapters**
  - [x] `model-pricing-writer.ts`: B0-A4 protocol verbatim (advisory xact lock, predecessor `FOR UPDATE`, overlap check, unique key backstop).
  - [x] `budget-admission.ts`: tenant strategy, pricing (max over effort variants, codex at model max output, input margin), atomic multi-bucket reservation, blocked attempts, durable dispatch marker, idempotent release, D2 partition guard, catalog quote seam, store probe.
  - [x] `route-settlement.ts`: one `cost_ledger` row per settled request, hold settle/release, overrun audit, allowlisted `attempts`, opaque `principal_key`, settlement outbox event, ledger probe.
  - [x] `reservation-reaper.ts`: expire holds past deadline (release never-dispatched, reconcile dispatched), idempotent and concurrency safe.
  - [x] `cost-ledger-sink.ts` / `index.ts`: observe-only sink kept for non-gateway API calls; barrel exports; gateway settlement never wires `recordLlmUsage`.

- [x] **Lot 2 — Product `/gw` and host wiring**
  - [x] `api/package.json` `@sentropic/llm-gateway` `^0.19.0` + `make lock-root`; product code imports no gateway source by relative path.
  - [x] `gw.ts` on `createGatewayNamespaceModule` (one mount) with budget, B2 identity, partition, settlement, readiness; remove `stubGatewayConfig`, noop `settleRoute()`, boot/request-time cutover activation; keep the author fence.
  - [x] `apps/llm-gateway/src/app.ts` budget slot + identity, `readiness.ts` store probes, `lifecycle.ts` B1 minors.

- [x] **Lot 3 — Tests and gates**
  - [x] `api/tests/api/llm-budget-ledger.test.ts` (new, real Postgres).
  - [x] `api/tests/unit/llm-metering-sink.test.ts` (update).
  - [x] `api/tests/api/cluster-mesh-gw.test.ts` (update).
  - [x] `apps/llm-gateway/tests/*.test.ts` (update for the budget slot).
  - [x] Lot gate:
    - [x] `make typecheck-api lint-api API_PORT=9471 UI_PORT=5671 MAILDEV_UI_PORT=1571 ENV=test-llm-product-admission`
    - [x] Scoped runs per new/changed test file with `SCOPE`.
    - [x] `make test-api-unit` + `make test-api-endpoints` (ports, ENV last).
    - [x] `make typecheck-llm-gateway-process lint-llm-gateway-process test-llm-gateway-process` (ports, ENV last).
    - [x] `make build-api REGISTRY=local` (ports, ENV last).
    - [x] `make scope-check`, `make down` + `make ps` (ports, ENV last).

- [x] **Lot N-1 — Docs consolidation**
  - [x] Spec: the `file:../packages/llm-gateway` line and the B3c status.

- [ ] **Lot N — Final validation**
  - [ ] Conductor: independent review, PR from `BRANCH.md`, CI, then removal of `BRANCH.md` before merge.
