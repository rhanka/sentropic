# Feature: App CM A4 follow-ups

## Objective
- [ ] Restore every test disabled in #879 with unchanged assertions, public optional authentication parity, and typed failure logging.

## Scope / Guardrails
- [x] Owner mandate 2026-11-05: A4-SELF-DELETE, V2 cascade, RC1 revocation fence, A4-ADOPTION-INTERLEAVE and A4-LANE-BLOCKED-SERIALIZE.
- [x] Branch `fix/app-cm-a4-followups` from `origin/main` (`c107f6abd`); worktree `tmp/worktrees/a4-followups`.
- [x] Slot owner: A4 follow-ups; API_PORT=8803 UI_PORT=5203 MAILDEV_UI_PORT=1103 ENV=test-a4-fu.
- [x] Docker commands through `.tmp/packets/docker-slot.sh`; ENV last; make-only; no Python.
- [x] Preserve assertions, timeouts and retry counts; no skip-CI, no CI reruns, no merge.
- [x] Commit with `make commit`, selective staging, at most 150 changed lines, no attribution trailers.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/identity/**`
  - `api/src/services/auth/**`
  - `api/src/services/cluster-mesh/session-workspace.ts`
  - `api/src/services/me.ts`
  - `api/src/middleware/auth.ts`
  - `api/src/routes/namespaces/auth/**`
  - `api/src/routes/namespaces/auth.ts`
  - `api/src/routes/auth/oauth.ts`
  - `api/src/routes/namespaces/users/**`
  - `api/src/routes/namespaces/workspaces/cm-member-ports.ts`
  - `api/tests/api/auth/**`
  - `api/tests/api/me.test.ts`
  - `api/tests/api/admin-users.test.ts`
  - `api/tests/api/session-adoption.test.ts`
  - `api/tests/unit/auth/**`
  - `api/tests/unit/identity/**`
  - `packages/cluster-mesh/src/identity/**`
  - `packages/cluster-mesh/src/storage/identity/**`
  - `packages/cluster-mesh/tests/identity/**`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception)**:
  - `api/drizzle/**`
  - `packages/cluster-mesh/package.json`
  - `package-lock.json`
- **Exception process**:
  - [x] Declare BRxx-EXn with reason, impact and rollback before conditional edits.

## Feedback Loop
- [ ] Track source: designated conductor imports this BRANCH.md; concurrent lane does not write `.track`.
- [x] Retired inherited main execution record in atomic documentation commits.

## AI Flaky tests
- [x] No provider-dependent tests in scope; every scoped regression must pass.

## Orchestration Mode (AI-selected)
- [x] Mono-branch, sequential implementation; no delegated build work.

## UAT Management (in orchestration context)
- [x] HTTP and storage regressions qualify server-only changes; no UI change.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read common rules, master, workflow, testing, template and #879 closure review; harness C1 PASS; ports free before startup.
- [ ] **Lot 1 — A4-SELF-DELETE and V2 cascade**
  - [ ] Authorize deletion-only re-entry after self-deactivation; preserve ordinary auth refusals and atomic cascade rollback.
  - [ ] Re-enable `api/tests/api/me.test.ts` (2) and `api/tests/api/auth/remote-revocation.test.ts` (4 lifecycle variants).
  - [ ] Qualify `api/tests/api/auth/cm-account-deletion.test.ts` and active self-deletion rejection.
- [x] **Lot 2 — RC1 revocation fence**
  - [x] Restored issuer private authority mint/rotation after acknowledged CM commit, local revocation closure and private signing fence.
  - [x] All 35 remote-session tests pass; private-session and integrity units pass. Refused-revocation fixtures must explicitly start without private authority.
- [x] **Lot 3 — A4-ADOPTION-INTERLEAVE**
  - [x] Request-scoped service interception occurs between the lock-free rights read and mutation transaction; current row authorization and CAS stay mandatory.
  - [x] Re-enabled stale-end test; all 38 tests in `api/tests/api/session-adoption.test.ts` pass with assertions unchanged.
- [ ] **Lot 4 — A4-LANE-BLOCKED-SERIALIZE**
  - [ ] Intercept live refresh transaction; bind consent revocation to current CM authority.
  - [ ] Re-enable 3 variants and qualify `api/tests/api/auth/oauth-refresh.integration.test.ts`.
- [ ] **Lot 5 — Optional authentication and logging**
  - [ ] Invalid/expired public credentials continue anonymously; infrastructure failures return 503; add both regressions; requireAuth unchanged.
  - [ ] Typed codes only for activity-touch and workspace-member catch-all logging.
- [ ] **Lot 6 — Docs consolidation and final validation**
  - [ ] Scoped API tests, API typecheck/lint; no requested test remains skipped.
  - [ ] Review final diff, resolve findings, push early, open one ready PR with BRANCH.md body, monitor CI until green; do not merge.
  - [ ] `make down-volumes`; report `.tmp/rv/a4-followups.md`.

