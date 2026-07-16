# Feature: Wire 429 failover & retry-with-rotation in llm-gateway

## Objective
Complete the gateway flow's integration with the existing llm-mesh cooldown/failover machinery: fix the cooldown auto-recovery bug, wire 429 detection into the flow, and add pre-stream retry-with-rotation. After this, h2a-runtime can drop its custom retry/failover code and consume `@sentropic/llm-gateway` directly.

## Context
The h2a-runtime (`a2a-cli/apps/llm-gateway`) carries its own 429 retry loop, quota exhaustion tracking, and cross-provider failover. The sentropic gateway has the underlying plumbing (`applyOutcome`, `isEligible`, `CoordinatorPoolState`) but it's not wired: `flow.ts` never records `'rate_limited'`, and a latent bug in `isEligible` makes cooldown permanent (no auto-recovery). This branch fixes the bugs and wires the missing pieces.

### What already exists (DO NOT re-implement)
- `selectAccount` in llm-mesh: priority → weighted-load → round-robin (account-transports.ts)
- `CoordinatorPoolState` in llm-gateway: per-owner coordinators, affinity keys, lease-based sticky
- `applyOutcome('rate_limited')` in llm-mesh: sets `status='cooldown'` + `cooldownUntil`
- `settle()` in flow.ts: already accepts `retryAfterMs` param (feeds into `recordOutcome`)
- `CoordinatorFactory` injection point for host-provided storage backends
- Existing test coverage: `sticky.test.ts`, `account-transports.test.ts`

### What is broken or missing (THIS BRANCH)
1. **BUG**: `isEligible()` requires `status === 'active'` — a cooled-down account (`status='cooldown'`) is permanently ineligible even after `cooldownUntil` expires. `isCooldownActive()` is dead code in this context. No auto-recovery path exists.
2. **MISSING**: `flow.ts` never records `'rate_limited'` — only `'success'` or `'failed'`. The existing `settle(retryAfterMs)` seam is never called with 429 data.
3. **MISSING**: No retry-with-rotation on 429 pre-stream. `GatewayDispatchStream` has no `status` field — stream path cannot detect 429. Design choice: use typed `ProviderRateLimitError` thrown by transport.
4. **DEFERRED**: Quota exhaustion tracking (h2a's 5h/week `QUOTA_WINDOW`) — can be modeled as long `cooldownUntil` on existing `'rate_limited'` outcome. No new status needed. Deferrable to follow-up branch.
5. **DEFERRED**: Cross-provider fallback — requires design review (pool-level, not coordinator-level). Deferrable to follow-up branch.

## Scope / Guardrails
- Scope limited to `packages/llm-gateway/` and `packages/llm-mesh/`.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/feat-gw-session-routing`.
- Tests on `ENV=test-gw-session`, never on root `dev`.
- `ENV=<env>` always last argument in make commands.
- All new text in English.
- h2a-runtime changes are OUT OF SCOPE — h2a adapts on its side after this lands.
- No new heavy dependencies in the library packages.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-gateway/src/**`
  - `packages/llm-gateway/tests/**`
  - `packages/llm-gateway/package.json`
  - `packages/llm-mesh/src/**`
  - `packages/llm-mesh/tests/**`
  - `packages/llm-mesh/package.json`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/*.md`
  - `api/src/**` (api wiring is a separate branch)
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/tests/**` (only if package changes break existing api tests — declare BR-GW-EX1)
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BR-GW-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
_(empty — will be populated as needed)_

## AI Flaky tests
- Acceptance rule: accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- [ ] **Multi-branch**
- Rationale: Cohesive bugfix + feature, all in llm-gateway + llm-mesh packages.

## Plan / Todo (lot-based)

- [ ] **Lot 0 — Baseline & constraints**
  - [ ] Read `flow.ts` settle/dispatch logic, confirm outcome recording paths.
  - [ ] Read h2a-runtime in `~/src/a2a-cli/apps/llm-gateway/src/` to map: `rebindAfterQuotaResponse` → retry loop, `markExhausted` → long cooldown.
  - [ ] Read `account-transports.ts` `isEligible` to confirm the cooldown auto-recovery bug.
  - [ ] Read `dispatch.ts` `GatewayDispatchStream` to confirm no status field.
  - [ ] Confirm worktree `tmp/feat-gw-session-routing` and env `test-gw-session`.

- [ ] **Lot 1 — Fix cooldown auto-recovery + wire 429 → rate_limited**
  - [ ] **Fix `isEligible` in llm-mesh**: when `account.status === 'cooldown'` and `cooldownUntil` has passed, treat as eligible (auto-recover to `'active'`). Pattern: similar to `releaseExpiredReservations`.
  - [ ] **Wire 429 in `flow.ts` (JSON path)**: detect `response.status === 429` from `GatewayDispatchResponse`, parse `Retry-After` header, call `settle()` with `retryAfterMs` and status `'rate_limited'` (not generic `'failed'`).
  - [ ] **Handle sticky lease during cooldown**: when a leased account enters cooldown, next acquire with same affinity key should select a new account (lease migrates). Document intended behavior.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh` + `make typecheck-llm-gateway`
    - [ ] `make test-llm-mesh` + `make test-llm-gateway`
    - [ ] **Tests**
      - [ ] llm-mesh: `applyOutcome('rate_limited')` → cooldown → `isEligible` rejects → cooldown expires → `isEligible` accepts again.
      - [ ] llm-mesh: existing `account-transports.test.ts` must still pass.
      - [ ] llm-gateway: 429 JSON response → account enters cooldown → next acquire rotates to different account.
      - [ ] llm-gateway: sticky lease migration — same affinity key gets new account after cooldown.

- [ ] **Lot 2 — Pre-stream retry-with-rotation on 429**
  - [ ] **Define typed error**: `ProviderRateLimitError` (extends existing gateway error taxonomy) thrown by transport dispatch when HTTP 429 is received. Carries `retryAfterMs` from `Retry-After` header.
  - [ ] **JSON path retry**: in `runJsonFlow`, catch `ProviderRateLimitError`, record `'rate_limited'` outcome, re-acquire from pool (rotation), retry dispatch. Max 2 retries. Only `select()` re-runs — auth + target resolution do NOT repeat.
  - [ ] **Stream path retry**: in `runStreamFlow`, if `dispatchStream` throws `ProviderRateLimitError` (i.e., pre-first-byte), same retry logic. If any bytes have been emitted, settle `'failed'` (no-retry-after-stream invariant).
  - [ ] **Cap retries**: configurable max (default 2). After exhaustion, settle `'failed'` with clear error.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-gateway`
    - [ ] `make test-llm-gateway`
    - [ ] **Tests**
      - [ ] 429 pre-stream → rotation → success on 2nd account.
      - [ ] 429 after stream started → no retry, settle failed.
      - [ ] Max retries exceeded → settle failed with exhaustion error.
      - [ ] JSON path: 429 → retry → 429 again → different account → success.

- [ ] **Lot 3 — Final validation**
  - [ ] `make typecheck-llm-gateway` + `make typecheck-llm-mesh`
  - [ ] `make test-llm-gateway` + `make test-llm-mesh`
  - [ ] Full CI: `make build-llm-gateway` + `make build-llm-mesh`
  - [ ] Bumped `packages/llm-gateway/package.json` version (minor: 429 retry behavior).
  - [ ] Bumped `packages/llm-mesh/package.json` version (patch: cooldown auto-recovery bugfix).
  - [ ] Create/update PR using `BRANCH.md` text as PR body.
  - [ ] Run/verify branch CI and resolve remaining blockers.
  - [ ] Once CI green, commit removal of `BRANCH.md`, push, and merge.

## Deferred to follow-up branches
- **Quota exhaustion tracking**: model as long `cooldownUntil` on existing `'rate_limited'` outcome. The `quota?: Record<string, unknown>` field on `AccountTransportOutcome` can carry window metadata. No new outcome status needed.
- **Cross-provider fallback**: requires design review. Must live at `CoordinatorPoolState.select()` or `flow.ts` level, NOT inside `coordinator.acquire()` (which is single-provider). Mark as separate branch with brainstorm.

## h2a-runtime adaptation (OUT OF SCOPE — for h2a to handle after merge)
After this branch merges, h2a-runtime (`a2a-cli/apps/llm-gateway`) should:
- Drop `rebindAfterQuotaResponse` — replaced by Lot 2 retry-with-rotation.
- Drop `markExhausted` / `pruneExpiredQuota` — replaced by llm-mesh cooldown auto-recovery + long cooldown windows (follow-up branch).
- Drop `selectAccountWithFallback` — deferred to cross-provider fallback branch.
- Provide K8s ConfigMap storage adapter as host-side `CoordinatorFactory` implementation.
- Keep only: launcher shim + env config + host-specific adapters.
