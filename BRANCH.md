# Feature: llm-gateway 0.19.0 budget admission — Lot D B3b

## Objective
- [x] Deliver the opt-in gateway budget admission (`BudgetAdmissionPort`, `admission.ts`) frozen in `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §5, §10 (B3b) and §12.2/§12.6, consuming the mesh 0.22.0 quote API.

## Scope / Guardrails
- [x] Branch `feat/llm-gateway-budget`, worktree `tmp/llm-gateway-budget`, based on `feat/llm-mesh-quote` (mesh 0.22.0 candidate).
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-llm-gateway-budget` last; never `ENV=dev` or `clean-all`.
- [x] Ports reserved if a service starts: API `9463`, UI `5663`, Maildev UI `1563` (gateway targets start no service).
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication (train only).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/**`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - `packages/llm-mesh/**`, `packages/cluster-mesh/**`, `api/**`, `apps/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - root `package-lock.json` only for the mesh dependency floor (BRDP-EX6, conductor-approved)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: port follows spec §12.2 names (`admit` = reserve, `release`, `markDispatched`); settlement stays the single `RouteMeteringSink.settleRoute` aggregate with optional `requestId`/`holdRef`/`quoteRef`/`overrun`, not a second port method.
- `attention`: pricing/store failure uses a new internal kind `budget-unavailable` mapped to the existing sanitized 503 bodies; the frozen error golden gains one additive row, no existing row changed.
- `attention`: missing request output ceiling is `bad-request` unless the host sets `defaultOutputTokens`; input ceiling reuses the gateway token estimate (bytes/4), and settlement charges actual usage unconditionally.
- `attention`: empty-candidate quote reserves nothing and throws mesh `RoutePlanError('no-route')`, the existing generic 503 path.
- `attention`: a non-finite `resetAtMs` yields `Retry-After: 60`; an admit rejection or malformed decision yields 503, never 429.
- `attention`: nothing dispatched → `release(holdRef)` then one zero-usage `settleRoute`; a dispatch-marker failure never calls the provider, releases the prepared attempt without health penalty and returns 503.
- `attention`: `overrun` lists any dispatched attempt whose reported usage exceeds its allowance (flagged with `outputCeilingEnforced`); the `blocked_attempts` audit write stays the host adapter's (B3c).
- `attention`: effort-insensitive candidate identity is handled by the port contract (adapter prices max over effort variants); the gateway passes no effort.
- `attention`: `tests/auth-subpaths.test.ts` installs the sibling workspace mesh candidate tarball while mesh `0.22.0` is absent from npm (registry used once published); required because the packed gateway now depends on `^0.22.0`.

## AI Flaky tests
- [x] Not applicable: deterministic unit and router tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 2; B0-D1 train integration by the conductor)
- Rationale: B3b is a disjoint gateway-only lane integrated later by the conductor.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §5, §10 (B3b), §12.2, §12.6, B0 review findings 6-7 and B3a review finding 8.
  - [x] Verify branch, registry latest `0.18.0`, target `0.19.0` free.
- [x] **Lot 1 — Budget port and admission**
  - [x] `src/ports/budget.ts`: `BudgetAdmissionPort`, decisions, settlement budget fields, error codes.
  - [x] `src/admission.ts`: ceiling, in-process quote, admit/reserve, Retry-After bound, dispatch marker, release, overrun.
  - [x] `router/errors.ts`: internal `budget-unavailable` kind on the existing sanitized 503 bodies.
- [x] **Lot 2 — Flow integration**
  - [x] `route-flow-core.ts`: admission before plan, `plan({ quote })`, one settlement with `requestId`/`holdRef`/`quoteRef`.
  - [x] `route-json-flow.ts`, `route-stream-flow.ts`: dispatch marker, allowance for missing usage, release when nothing dispatched.
  - [x] `router/index.ts`: opt-in `budget` option; construction error when the planner has no `quote()`.
- [x] **Lot 3 — Tests**
  - [x] New `tests/budget-admission.test.ts`.
  - [x] Update `tests/{route-json-flow,route-stream-flow,errors,contract-snapshot}.test.ts`.
- [x] **Lot 4 — Version and docs**
  - [x] `package.json` 0.19.0, mesh `^0.22.0`; `CHANGELOG.md`; README budget section.
- [x] **Lot N — Final validation**
  - [x] `make typecheck-llm-gateway lint-llm-gateway test-llm-gateway build-llm-gateway pack-llm-gateway ENV=test-llm-gateway-budget` (26 files, 261 tests pass; manifest guard PASS)
  - [x] `make test-llm-mesh ENV=test-llm-gateway-budget` (32 files, 270 tests pass)
  - [x] `make scope-check ENV=test-llm-gateway-budget` (PASS C2; branch diff limited to `packages/llm-gateway/**` and `BRANCH.md`)
  - [x] Candidate `sentropic-llm-gateway-0.19.0.tgz` sha256 `f444a581ffa7823587f8d83215117444e59f0e4b8ecd60fae82563f176640505` (pack guard at `71c296f9b`, not persisted, not published).
