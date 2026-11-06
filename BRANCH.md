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
- [x] **Lot 1 — A4-SELF-DELETE and V2 cascade**
  - [x] Five-minute deletion-only continuation binds the initiating credential to self-deactivation; ordinary auth stays revoked; V2 rechecks self-disable status under lock.
  - [x] Re-enabled `me.test.ts` (2) and `remote-revocation.test.ts` (4 lifecycle variants); all 56 deletion/lifecycle tests pass. Ownership and privileged restore fixtures match CM invariants.
  - [x] V2 cascade and injected atomic rollback pass; committed HTTP deletion returns 200 with explicit delivery_pending/complete=false until outbox delivery; four negative continuation tests pass.
  - [x] `remote-revocation.test.ts` restores account/profile/fence snapshots through the privileged fixture path; normal account creation continues refusing retired ids. Refused-delivery cases retain an empty private starting state and unchanged assertions.
  - [x] Review P1/P2: pass the verified continuation into both V2 authorization phases, recheck credential/epoch/expiry under lock, and reject stale deactivation credentials before mutation; forced refresh and active-DELETE races qualified.
  - [x] Eight self-deletion regressions pass, including proof expiry after admission and after V2 reservation; original lifecycle assertions now exercise real account authentication.
- [x] **Lot 2 — RC1 revocation fence**
  - [x] Restored issuer private authority mint/rotation after acknowledged CM commit, local revocation closure and private signing fence.
  - [x] All 35 remote-session tests pass; private-session and integrity units pass. Refused-revocation fixtures must explicitly start without private authority.
  - [x] Private-session wrapping preserves the deferred-mail getter; registration and authentication regressions pass.
  - [x] Private projections require non-null refresh binding material; continuation cleanup matches exact subject/session proof ids.
- [x] **Lot 3 — A4-ADOPTION-INTERLEAVE**
  - [x] Request-scoped service interception occurs between the lock-free rights read and mutation transaction; current row authorization and CAS stay mandatory.
  - [x] Re-enabled stale-end test; all 38 tests in `api/tests/api/session-adoption.test.ts` pass with assertions unchanged.
- [x] **Lot 4 — A4-LANE-BLOCKED-SERIALIZE**
  - [x] Intercept live refresh transaction after subject/refresh locks; revoke CM consent, protocol evidence and subject revision atomically.
  - [x] All 12 refresh integration tests pass with assertions unchanged; writer uses the real CM request runner and its unchanged attempt budget. Both consent-plane rollback/restoration regressions pass.
  - [x] Missing CM consent authority refuses even when a protocol evidence row remains; no fallback from the protocol row to authority.
- [x] **Lot 5 — Optional authentication and logging**
  - [x] Invalid/expired public credentials continue anonymously; infrastructure failures return 503; all three focused regressions pass; requireAuth unchanged.
  - [x] Activity-touch and workspace-member catch-all log only known custody codes or validated SQLSTATEs, with a fixed generic code otherwise.
- [ ] **Lot 6 — Docs consolidation and final validation**
  - [x] Scoped API tests: 182/182 in 15 files; all requested tests enabled and original assertions unchanged. API typecheck/lint qualified separately.
  - [ ] Review final diff, resolve findings, push early, open one ready PR with BRANCH.md body, monitor CI until green; do not merge.
  - [ ] `make down-volumes`; report `.tmp/rv/a4-followups.md`.
