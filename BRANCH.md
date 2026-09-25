# Feature: llm-gateway 0.19.0 budget admission — Lot D B3b

## Objective
- [ ] Deliver the opt-in gateway budget admission (`BudgetAdmissionPort`, `admission.ts`) frozen in `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §5, §10 (B3b) and §12.2/§12.6, consuming the mesh 0.22.0 quote API.

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

## AI Flaky tests
- [x] Not applicable: deterministic unit and router tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 2; B0-D1 train integration by the conductor)
- Rationale: B3b is a disjoint gateway-only lane integrated later by the conductor.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §5, §10 (B3b), §12.2, §12.6, B0 review findings 6-7 and B3a review finding 8.
  - [x] Verify branch, registry latest `0.18.0`, target `0.19.0` free.
- [ ] **Lot 1 — Budget port and admission**
  - [ ] `src/ports/budget.ts`: `BudgetAdmissionPort`, decisions, settlement budget fields, error codes.
  - [ ] `src/admission.ts`: ceiling, in-process quote, admit/reserve, Retry-After bound, dispatch marker, release, overrun.
  - [ ] `router/errors.ts`: internal `budget-unavailable` kind on the existing sanitized 503 bodies.
- [ ] **Lot 2 — Flow integration**
  - [ ] `route-flow-core.ts`: admission before plan, `plan({ quote })`, one settlement with `requestId`/`holdRef`/`quoteRef`.
  - [ ] `route-json-flow.ts`, `route-stream-flow.ts`: dispatch marker, allowance for missing usage, release when nothing dispatched.
  - [ ] `router/index.ts`: opt-in `budget` option; construction error when the planner has no `quote()`.
- [ ] **Lot 3 — Tests**
  - [ ] New `tests/budget-admission.test.ts`.
  - [ ] Update `tests/{route-json-flow,route-stream-flow,errors,contract-snapshot}.test.ts`.
- [ ] **Lot 4 — Version and docs**
  - [ ] `package.json` 0.19.0, mesh `^0.22.0`; `CHANGELOG.md`; README budget section.
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-llm-gateway lint-llm-gateway test-llm-gateway build-llm-gateway pack-llm-gateway ENV=test-llm-gateway-budget`
  - [ ] `make test-llm-mesh ENV=test-llm-gateway-budget`
  - [ ] `make scope-check ENV=test-llm-gateway-budget`
  - [ ] Candidate tarball sha256 recorded (not published).
