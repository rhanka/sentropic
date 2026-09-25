# Feature: llm-mesh 0.22.0 pure quote API — Lot D B3a

## Objective
- [x] Deliver the pure, synchronous `quoteRoute` seam frozen in `spec/SPEC_EVOL_LLM_DEPLOYABLE_PROCESS.md` §12.2 (mesh 0.22.0), with `plan({ quote })` pinning and `quote-mismatch` refusal.

## Scope / Guardrails
- [x] Branch `feat/llm-mesh-quote`, worktree `tmp/llm-mesh-quote`, base `origin/main` `a334fab47`, merged with `origin/main` `481f56147` (#613) in fix round 1.
- [x] Make-only checks; Docker-first; no Python; English text; `ENV=test-llm-mesh-quote` last; never `ENV=dev` or `clean-all`.
- [x] Ports reserved if a service starts: API `9462`, UI `5662`, Maildev UI `1562` (mesh targets start no service).
- [x] Selective staging and separate `make commit`; update checkboxes in each atomic commit, approximately 150 lines maximum.
- [x] HARD STOP: no push, no PR, no merge, no publication; merging this bump would publish mesh 0.22.0 (owner GO pending).

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/**` (conductor ruling, fix round 1; incl. `route-selection.ts`, `CHANGELOG.md`, `package.json` 0.22.0)
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
- `attention`: `quoteRef` is an FNV-1a 64 digest of canonical route input fields, resolved profile name and the quoted body (candidates with allowances, `maxAttempts`, revisions); raw `ceiling`/`now` enter through allowances and council-filtered candidates so `plan()` can recompute it. Consistency reference only, not an authentication tag.
- `attention`: an unpinned candidate whose provider lists `codex` among its account transports (OpenAI) is flagged `outputCeilingEnforced: false` (conservative).
- `attention`: unknown `policyProfile` in a quote throws `RoutePlanError('no-route')` exactly as `plan()`; invalid policy throws `RoutePolicyError`; an invalid `now` Date is `invalid-ceiling`.
- `attention`: `explicit` narrows the quote by provider/model/alias/transport only (an unpinned candidate is pinned to the explicit transport); `diagnosticAccountRef` is account-bound and ignored, so the quote stays a superset and may be empty.
- `attention`: candidate identity is provider/model/optional transport (the frozen shape has no effort); duplicates keep the first occurrence.
- `attention`: `plan({ quote })` filters planned candidates to quoted ones and ignores a sticky affinity whose target the quote does not cover (normal selection among quoted candidates); `quote-mismatch` remains only as a defensive refusal when every planned candidate is unquoted.
- `attention` (mesh owner): without a quote, a sticky affinity still dispatches its bound model; asking `gemini-3.5-flash` after a `gemini-3.7-flash` affinity plans `gemini-3.7-flash`. Unchanged here (out of scope), pinned by test.
- `attention`: `RouteQuote.quotedAt` (ISO of the quote `now`, inside `quoteRef`) is additive to the §12.2 shape; `plan({ quote })` evaluates council freshness at it so quote and plan never diverge; planner clock still drives health, plan TTL and eviction.
- `attention`: planning and quoting share `resolveRouteTargets` (`route-selection.ts`); the quote adds only the account-independent explicit narrowing and provider/model/transport dedup.
- `attention`: `requiredCapabilities` is order-normalized (sorted canonical entries) inside `quoteRef`.
- `attention` (mesh owner follow-up): the planner constructor does not validate the council (overlapping groups are accepted).
- `attention` (spec owner question): one equivalent below the input ceiling context window refuses the whole quote with `invalid-ceiling` (§12.2 as written); dropping only that candidate is an alternative.
- `attention` (B3b watch): quote must be mandatory on the budgeted path; define handling of an empty-candidate quote; identity has no effort so price the max over effort variants; never accept an external quote.

## AI Flaky tests
- [x] Not applicable: pure unit tests, no provider call.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch** (Lot D wave 1: B1 in parallel; B0-D1 train integration by the conductor)
- Rationale: B3a is a disjoint mesh-only lane integrated later by the conductor.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read spec §5, §10 (B3a), §12.1/§12.2 and B0 review findings 4, 5, 7.
  - [x] Verify branch, registry latest `0.21.2`, target `0.22.0` free.
- [x] **Lot 1 — Quote seam**
  - [x] Contract types in `routing-contracts.ts`; `RoutePlanError` gains `quote-mismatch`.
  - [x] `route-quote.ts`: `quoteRoute`, `RouteQuoteError`, `MAX_ROUTE_QUOTE_CANDIDATES`, shared quote digest.
  - [x] `InMemoryRoutePlanner.quote` and `plan({ quote })` pinning.
  - [x] Export from the package entry.
  - [x] Lot gate:
    - [x] `make typecheck-llm-mesh lint-llm-mesh ENV=test-llm-mesh-quote`
    - [x] `make test-llm-mesh SCOPE=tests/budget-quote.test.ts ENV=test-llm-mesh-quote`
- [x] **Lot 2 — Tests**
  - [x] New `packages/llm-mesh/tests/budget-quote.test.ts`: 16-cap, 1..8 attempts, superset vs plan across fallback, zero directory calls, purity/determinism, each error code, quote-mismatch, codex allowance list, maxOutputTokens profile list, no unquoted execution.
- [x] **Lot 3 — Version and docs**
  - [x] `packages/llm-mesh/package.json` 0.22.0; `CHANGELOG.md`; README quote section.
- [x] **Lot 4 — Fix round 1 (muse needs changes)**
  - [x] Merge `origin/main` `481f56147`; diff vs `origin/main` limited to `packages/llm-mesh/**` and `BRANCH.md`.
  - [x] Shared `resolveRouteTargets` used by `selectRouteCandidates` and `quoteRoute`; duplicate removed.
  - [x] Pinned plan ignores an unquoted sticky affinity; council freshness at `quote.quotedAt`; capability order normalized in `quoteRef`.
  - [x] Tests: multi-group council with transport preferences and an expiring group, skewed planner clock, attempt capping, `diagnosticAccountRef`, capability order.
  - [x] `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh build-llm-mesh pack-llm-mesh ENV=test-llm-mesh-quote` (32 files, 270 tests pass)
  - [x] `make scope-check ENV=test-llm-mesh-quote`
  - [x] Candidate `sentropic-llm-mesh-0.22.0.tgz` sha256 `91fce7217da6abb60b93d6af04db7a873df4a7826795f6893970f15c77810751` (guard pass after fix round 1, not persisted, not published; supersedes `eb3d6a8a…`).
- [x] **Lot N — Final validation**
  - [x] `make typecheck-llm-mesh lint-llm-mesh test-llm-mesh build-llm-mesh pack-llm-mesh ENV=test-llm-mesh-quote` (32 files, 265 tests pass)
  - [x] `make scope-check ENV=test-llm-mesh-quote`
  - [x] Candidate `sentropic-llm-mesh-0.22.0.tgz` sha256 `eb3d6a8af8f490a2aba9f624889a4bc210e8b4777ba44ad7d97807d079928b6b` (guard pass at `2503476eb`, not persisted, not published).
