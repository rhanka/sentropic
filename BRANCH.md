# BR-FUSION-E1: L2 Fusion E1 owner-signature lives in h2a Track carnet

## Objective
Record owner-signature in shared h2a Track log with sentropic as gatekeeper (verify decision-owner-only), local carnet as documented non-authoritative journal, deferring crypto channel-attribution and opposable under-lock recheck to deployed-E2.

## The honest trust-boundary
> The fusion moves the trust boundary INTO sentropic. Track RECORDS but never verifies; `evidence.subject` (who signed) is payload, not channel identity. So this is an **author-signature (owner)** = sentropic's verification + record, distinct from a Track **freshness-signature** (a hash, e.g. branchSignature). In LOCAL E1 on the owner's own machine, **the Track carnet is a faithful journal, NOT a cryptographic proof**; the "owner-only, once" guarantee holds because **sentropic is the de-facto sole writer of author-signatures in the local single-user context — this is a CONVENTION, NOT an opposable constraint** (h-arch: habit-level). **Cryptographic channel-attribution (`signed`/M3) AND the opposable under-lock recheck (Y) are DEFERRED to deployed-E2 (multi-tenant, larger threat surface) — an explicit, acknowledged debt.**

## Scope / Guardrails
- Local E1 track signature fusion (Option ① / path 2).
- No edits in `~/src/h2a` (esp. `registry.ts` / #199/#208 zone).
- Write ONLY via `decision.add-artifact` path in `local-user`.
- Make-only workflow, no direct Docker/npm commands.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile` (`BR-FUSION-EX1` scope exception)
  - `package.json`
  - `package-lock.json`
  - `api/package.json`
  - `api/src/services/focus/**`
  - `api/src/routes/api/focus.ts`
  - `api/src/middleware/auth.ts`
  - `api/src/utils/workspace-id.ts`
  - `api/tests/unit/focus-*.test.ts`
  - `api/tests/unit/track-*.test.ts`
  - `packages/focus/package.json`
  - `packages/focus/src/**`
  - `packages/focus/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `~/src/h2a/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`BR-FUSION-EX1`)
- **Exception process**:
  - `BR-FUSION-EX1`: Makefile target `owner-sign` helper for dev-local UAT.

## Feedback Loop
- `BR-FUSION-E1`: L2 Fusion E1 active.

## AI Flaky tests
- Acceptance rule: Non-systematic provider/network nondeterminism only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single workstream for Fusion E1 signature port and validator).

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline, packages, and scope setup**
  - [x] Verify branch `feat/track-signature-fusion-e1` off `origin/main`.
  - [ ] Bump `@sentropic/track` to 0.91.0 in `packages/focus/package.json` and lockfile.
  - [ ] Add `api/src/utils/workspace-id.ts` pure function helper using `@sentropic/track`.
- [ ] **Lot 1 — `TrackEventOwnerSignaturePort` & DecisionValidator**
  - [ ] Implement `TrackEventOwnerSignaturePort` in `api/src/services/focus/track-event-owner-signature-port.ts`.
  - [ ] Implement real `TrackDecisionValidator` in `api/src/services/focus/decision-validator.ts`.
  - [ ] Update `createApiFocusLiveSession` in `api/src/services/focus/live-session.ts` for local vs PG env selection.
- [ ] **Lot 2 — Route & identity unification**
  - [ ] Unify identity to verified email (`human:<email>`) and workspace in `api/src/routes/api/focus.ts`.
  - [ ] Update `api/src/middleware/auth.ts` to surface user `email`.
- [ ] **Lot 3 — Makefile helper & Tests**
  - [ ] Add `make owner-sign DECISION=<id>` target to `Makefile`.
  - [ ] Real-race atomicity test in `api/tests/unit/track-event-owner-signature-port.test.ts`.
  - [ ] Fail-closed matrix test in `api/tests/unit/focus-decision-validator.test.ts`.
  - [ ] Route test update in `api/tests/unit/focus-owner-signature-route.test.ts`.
- [ ] **Lot 4 — Final validation & Harness check**
  - [ ] Run `make typecheck-api`, `make test-focus`, and unit tests.
  - [ ] Verify `harness check scope` and `harness check branch`.
