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
  - `api/tests/helpers/owner-sign-child.ts` (`BR-FUSION-EX2` scope exception)
  - `packages/focus/package.json`
  - `packages/focus/src/**`
  - `packages/focus/tests/**`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `~/src/h2a/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (`BR-FUSION-EX1`)
  - `api/tests/helpers/owner-sign-child.ts` (`BR-FUSION-EX2`)
- **Exception process**:
  - `BR-FUSION-EX1`: Makefile target `owner-sign` helper for dev-local UAT.
  - `BR-FUSION-EX2`: PR #536 review F1a — the in-process real-race test cannot exercise the real cross-process Track file-lock (`ingest`'s lock section is synchronous, so `Promise.all` in one process never interleaves). Rationale: a genuine 2-OS-process race requires a spawned child script; `api/tests/helpers/` is the existing repo convention for test-only helper scripts. Impact: one new test-only file, no runtime/prod code path. Rollback: delete the file and the cross-process `it()` block in `track-event-owner-signature-port.test.ts`; the in-process dedup test still covers the deterministic-clientToken invariant.

## Feedback Loop
- `BR-FUSION-E1`: L2 Fusion E1 active.

## AI Flaky tests
- Acceptance rule: Non-systematic provider/network nondeterminism only.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch** (single workstream for Fusion E1 signature port and validator).

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, packages, and scope setup**
  - [x] Verify branch `feat/track-signature-fusion-e1` off `origin/main`.
  - [x] Bump `@sentropic/track` to 0.91.0 in `packages/focus/package.json` and lockfile.
  - [x] Add `api/src/utils/workspace-id.ts` pure function helper using `@sentropic/track`.
- [x] **Lot 1 — `TrackEventOwnerSignaturePort` & DecisionValidator**
  - [x] Implement `TrackEventOwnerSignaturePort` in `api/src/services/focus/track-event-owner-signature-port.ts`.
  - [x] Implement real `TrackDecisionValidator` in `api/src/services/focus/decision-validator.ts`.
  - [x] Update `createApiFocusLiveSession` in `api/src/services/focus/live-session.ts` for local vs PG env selection.
- [x] **Lot 2 — Route & identity unification**
  - [x] Unify identity to verified email (`human:<email>`) and workspace in `api/src/routes/api/focus.ts`.
  - [x] Update `api/src/middleware/auth.ts` to surface user `email`.
- [x] **Lot 3 — Makefile helper & Tests**
  - [x] Add `make owner-sign DECISION=<id>` target to `Makefile`.
  - [x] Real-race atomicity test in `api/tests/unit/track-event-owner-signature-port.test.ts`.
  - [x] Fail-closed matrix test in `api/tests/unit/focus-decision-validator.test.ts`.
  - [x] Route test update in `api/tests/unit/focus-owner-signature-route.test.ts`.
- [x] **Lot 4 — Final validation & Harness check**
  - [x] Run `make typecheck-api`, `make test-focus`, and unit tests.
  - [x] Verify `harness check scope` and `harness check branch`.
- [ ] **Lot 5 — PR #536 opus 4.8 review fixes (3 MEDIUM)**
  - [x] F1a: replace the misleading "real file-lock race" in-process test with an honestly-retitled in-process dedup test plus a real cross-process test (`api/tests/helpers/owner-sign-child.ts`, `BR-FUSION-EX2`).
  - [x] F1b: derive `written`/`duplicate` from the persisted record's `idempotencyKey`, not a racy `readAll()` count bracket, in `track-event-owner-signature-port.ts`.
  - [ ] F2: `createApiFocusLiveSession` storeMode — fail-loud on an unrecognized `NODE_ENV` instead of silently defaulting to `local`; `postgres` for `production`, `local` only for known dev/test envs or explicit `TRACK_STORE_MODE=local`.
  - [ ] CI: pin `@sentropic/track` to `0.91.1` via a root `package.json` override (lockfile already resolved 0.91.1; override guards against a future accidental drift within the `^0.91.0` range).
  - [ ] Re-run `make typecheck-api`, `make lint-api`, and the affected unit suites; request a blind opus 4.8 re-review.
