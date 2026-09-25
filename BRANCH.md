# Feature: llm-mesh 0.22.0 pure quote API — Lot D B3a

## Objective
- [ ] Deliver the pure, synchronous `quoteRoute` seam frozen in `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §12.2 (mesh 0.22.0), with `plan({ quote })` pinning and `quote-mismatch` refusal.

## Scope / Guardrails
- [x] Branch `feat/llm-mesh-quote`, worktree `tmp/llm-mesh-quote`, base `origin/main` `a334fab47`.
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-llm-mesh-quote` last; never `ENV=dev` or `clean-all`.
- [x] Ports reserved if a service starts: API `9462`, UI `5662`, Maildev UI `1562` (mesh targets start no service).
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication; merging this bump would publish mesh 0.22.0 (owner GO pending).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/{route-quote,routing-contracts,route-planner,route-planner-state,index}.ts`
  - `packages/llm-mesh/tests/budget-quote.test.ts`
  - `packages/llm-mesh/package.json` (0.22.0)
  - `packages/llm-mesh/README.md`
  - `packages/llm-mesh/CHANGELOG.md`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
  - `plan/**`
  - `deploy/**`
  - other `packages/**` (gateway, cluster-mesh), `api/**`, `apps/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json` version refresh (BRDP-EX6)
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.

## Feedback Loop
- `attention`: root `package-lock.json` and `api/package-lock.json` keep the `0.21.2` workspace version field; prior mesh bumps (`a4359f18c`) did not refresh it, so BRDP-EX6 is not used.

## AI Flaky tests
- [x] Not applicable: pure unit tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 1: B1 in parallel; B0-D1 train integration by the conductor)
- Rationale: B3a is a disjoint mesh-only lane integrated later by the conductor.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §5, §10 (B3a), §12.1/§12.2 and B0 review findings 4, 5, 7.
  - [x] Verify branch, registry latest `0.21.2`, target `0.22.0` free.
- [ ] **Lot 1 — Quote seam**
  - [x] Contract types in `routing-contracts.ts`; `RoutePlanError` gains `quote-mismatch`.
  - [ ] `route-quote.ts`: `quoteRoute`, `RouteQuoteError`, `MAX_ROUTE_QUOTE_CANDIDATES`, shared quote digest.
  - [ ] `InMemoryRoutePlanner.quote` and `plan({ quote })` pinning.
  - [ ] Export from the package entry.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh lint-llm-mesh ENV=test-llm-mesh-quote`
    - [ ] `make test-llm-mesh SCOPE=tests/budget-quote.test.ts ENV=test-llm-mesh-quote`
- [ ] **Lot 2 — Tests**
  - [ ] New `packages/llm-mesh/tests/budget-quote.test.ts`: 16-cap, 1..8 attempts, superset vs plan across fallback, zero directory calls, purity/determinism, each error code, quote-mismatch, codex allowance list, maxOutputTokens profile list, no unquoted execution.
- [ ] **Lot 3 — Version and docs**
  - [ ] `packages/llm-mesh/package.json` 0.22.0; `CHANGELOG.md`; README quote section.
- [ ] **Lot N — Final validation**
  - [ ] `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh build-llm-mesh pack-llm-mesh ENV=test-llm-mesh-quote`
  - [ ] `make scope-check ENV=test-llm-mesh-quote`
  - [ ] Record packed tarball name and sha256 (local candidate only).
