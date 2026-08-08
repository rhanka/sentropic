# Fix(sec): tenant-resolver cache invalidation on membership transitions (authz-staleness)

## Objective
- [x] Close the pre-existing authorization-staleness bypass in `api/src/services/tenancy/resolve-tenant.ts`: the tenant-resolution cache was process-lifetime with NO invalidation/TTL, so a SUSPENDED/revoked user kept resolving as authorized until process restart. Found by the #526 independent build-review (verified NOT introduced by #526).

## Scope / Guardrails
- [x] `resolve-tenant.ts`: bounded TTL (`CACHE_TTL_MS=30_000`), `invalidateResolveTenantCache()` (clear-all + generation bump), and a generation-guard so a resolve in flight during an invalidation cannot repopulate a stale entry (TOCTOU). No change to `reconcileTenantId` mode logic (alias/shadow/strict) or the resolution queries.
- [x] `tenant-membership.ts`: `decideMembership()` calls `invalidateResolveTenantCache()` after the status-update (approve/reject/suspend). No import cycle (one-way `auth -> tenancy`).
- [x] Test `api/tests/unit/tenant-resolver-invalidation.test.ts`: suspension-deny (approve -> resolve OK -> suspend -> resolve DENIED). In `tests/unit/` so CI globs it.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths**: `api/src/services/tenancy/resolve-tenant.ts`, `api/src/services/auth/tenant-membership.ts`, `api/tests/unit/tenant-resolver-invalidation.test.ts`, `BRANCH.md`
- **Forbidden Paths**: everything else (routes, other services, packages, Makefile, Dockerfiles, migrations).
- **Conditional Paths**: none.

## Feedback Loop
- [x] `SEC-TENANT-BUILD` — Built by codex terra (xhigh); builder != reviewer.
- [x] `SEC-TENANT-REVIEW` — Independent adversarial review (2 passes, reviewer != builder != orchestrator): VERDICT SHIP-WITH-NOTES. In-process bypass closed; the TOCTOU cache-poisoning race is retired by the generation-guard (capture-before-read + conditional-set, both interleavings traced); no regression, no import cycle; test is non-vacuous (fails on origin/main).
- [x] `SEC-TENANT-SEVERITY` — Recalibrated: default `TENANT_RESOLUTION_MODE=shadow`, and the only prod consumer `reconcileTenantId` is shadow/measure-only, so this bypass is LATENT (authz-live only at/after the strict cutover), not live authz bleed today. This fix is the prerequisite for a safe strict cutover.
- [ ] `SEC-TENANT-CROSSPOD` — The invalidation is PER-PROCESS; on a multi-replica deploy the 30s TTL is the true cross-pod revocation guarantee (a suspended user can still resolve on other pods for <=30s). Documented in-code. OWNER SIGN-OFF on the 30s window required before the strict-mode cutover (owner may want a shorter TTL).
- [ ] `SEC-TENANT-TESTGAP` — Follow-up: the 30s TTL-expiry branch and the generation-guard race path have no unit test (a clean test needs injectable time; fake-timers + real DB is not a proven-safe pattern in this suite). Add a TTL-expiry + concurrent resolve-vs-invalidate test via a small time-injection refactor.
- [ ] `SEC-TENANT-CASCADE` — Follow-up: FK cascade user-deletion (`admin.ts:366`, `me.ts:306`) deletes memberships WITHOUT calling `invalidateResolveTenantCache()`; bounded by the 30s TTL. Add invalidation there (or accept the TTL bound).

## AI Flaky tests
- Not applicable: service + unit test only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch + cherry-pick.
- [ ] Multi-branch.
- Rationale: one atomic security fix (2 files + 1 test); codex-built, independently reviewed, conductor-gated.

## Plan / Todo (lot-based)
- [x] Lot 0 — RCA: process-lifetime cache bakes membership status; `decideMembership` is the single transition point; no import cycle.
- [x] Lot 1 — codex terra builds invalidation + TTL + generation-guard + suspension-deny test.
- [x] Lot 2 — Independent review (2 passes, SHIP-WITH-NOTES; TOCTOU retired); accurate cross-pod doc comment.
- [ ] Lot 3 — PR CI green (suspension-deny test + build) -> conductor gate -> merge -> report; owner sign-off on the 30s window before strict cutover.
