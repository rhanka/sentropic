# Feature: App CM A4 follow-ups

## Objective
- [x] Restore every test disabled in #879 with unchanged assertions, public optional authentication parity, and typed failure logging.

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
  - `e2e/tests/06-settings-codex-provider.spec.ts`
  - `e2e/tests/03-dashboard.spec.ts`
  - `e2e/tests/03-chat-mobile-docked-nav.spec.ts`
  - `e2e/Dockerfile`
  - `e2e/tests/08-chat-workspace-switch.spec.ts`
  - `e2e/tests/02-organizations.spec.ts`
  - `e2e/tests/01-organizations-detail.spec.ts`
  - `ui/src/routes/organizations/new/+page.svelte`
  - `ui/src/routes/organizations/[id]/+page.svelte`
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
  - [x] BR929-EX1: extend scope to the single Codex settings E2E spec after CI 42157095451 observed the mode array before its asynchronous POST completed. Impact: synchronize existing clicks with their exact response; preserve every assertion, timeout and retry count. Rollback: remove the response handshake if the interaction contract changes. Evidence: `.tmp/rv/a4-followups.md` and browser-shard-3 artifacts.
  - [x] BR929-EX2: extend scope to the dashboard E2E spec after CI 42174483201 observed the static viewer lock disappear between its visibility/class assertions when initial presence replaced it. Serial local replay also inherited a previous case's completed DOCX job. Impact: await initial presence readiness and give each case its own workspace/folder; preserve all assertions, timeouts and retries. Rollback: remove the handshake or per-case fixture if those contracts change. Evidence: `.tmp/rv/a4-followups-ci2-shard4` and `.tmp/a4-followups-dashboard-after.log`.
  - [x] BR929-EX3: extend scope to the chat placement E2E spec after CI 42177231942 measured the right panel after a left drop. Controlled workspace hydration reproduced the exact 964.8125 coordinate: the drag wrote left under default, then hydration replaced that controller. Impact: await workspace identity before the gesture, keeping assertions, timeouts and retries unchanged. Rollback: remove the readiness wait if placement scoping changes. Evidence: `.tmp/rv/a4-followups-ci3-shard4` and `.tmp/a4-followups-chat-workspace-gate.log`.
  - [x] BR929-EX4: extend scope to the E2E Dockerfile after CI 42180070528 identified HIGH CVE-2026-85091 in zlib 1.3.2-r0, with Alpine fixed version 1.3.2-r1. Impact: install the exact patched package in the existing browser layer; scanner, policy, assertions and retries unchanged. Rollback: replace the pin when the maintained base includes the fix. Evidence: `.tmp/rv/a4-followups-ci4-security/container-e2e.json`.
  - [x] BR929-EX5: extend scope to the three browser specs failing in CI 42180070528: session navigation remains on the list, organization deletion leaves a draft, and presence is visible in only one peer despite two server records. Impact: controlled diagnosis and narrowly scoped fixture/readiness corrections with original assertions, timeouts and retries preserved. Rollback: remove each handshake when its underlying initialization contract changes. Evidence: `.tmp/rv/a4-followups-ci4-shard2`, `a4-followups-ci4-shard5`, `a4-followups-ci4-shard6`.
  - [x] BR929-EX6: extend scope to organization creation/detail routes for the actual races exposed by CI 42180070528. A held draft response reproduces the original deletion count failure; an in-flight draft must be awaited and reused. Detail presence HTTP snapshots need a fence against newer SSE state. Impact: bounded concurrency fixes with controlled browser regressions, no assertion/policy/budget changes. Rollback: replace these local fences if their upstream concurrency contracts change. Evidence: `.tmp/a4-followups-organizations-draft-red.log` and independent CI4 diagnosis reviews.

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
  - [x] V2 cascade and injected atomic rollback pass; committed HTTP deletion returns 200 with explicit delivery_pending/complete=false until outbox delivery; eight continuation regressions pass.
  - [x] `remote-revocation.test.ts` restores account/profile/fence snapshots through the privileged fixture path; normal account creation continues refusing retired ids. Refused-delivery cases retain an empty private starting state and unchanged assertions.
  - [x] Review P1/P2: pass the verified continuation into both V2 authorization phases, recheck credential/epoch/expiry under lock, and reject stale deactivation credentials before mutation; forced refresh and active-DELETE races qualified.
  - [x] Eight self-deletion regressions pass, including proof expiry after admission and after V2 reservation; original lifecycle assertions now exercise real account authentication.
- [x] **Lot 2 — RC1 revocation fence**
  - [x] Restored issuer private authority mint/rotation after acknowledged CM commit, local revocation closure and private signing fence.
  - [x] All 35 remote-session tests pass; private-session and integrity units pass. Refused-revocation fixtures must explicitly start without private authority.
  - [x] Private-session wrapping preserves the deferred-mail getter; registration and authentication regressions pass.
  - [x] Private projections require non-null refresh binding material; continuation cleanup matches exact subject/session proof ids.
  - [x] Astra P1: controlled post-commit publication reproduced the gap, then passed with exact owned-session tombstones captured in the V2 outbox before cleanup. Fully acknowledged deletion refuses late publication and restored authority.
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
  - [x] Scoped API tests: 183/183 in 16 files after the V2 fence correction; all requested tests enabled and original assertions unchanged. API typecheck/lint qualified separately.
  - [x] Two independent Sol fallback reviews approve implementation `b9742ff4e`; credential-binding and V2 authorization races resolved. Vibe 402 and Argon 429 prevent complementary-model review; no such consensus claimed.
  - [x] Early safety pushes made; final implementation and scoped validation committed.
  - [x] CI browser-shard-3: exact failure reproduced with a temporary request gate; awaiting each mode POST makes the forced case pass. Probe removed; normal single-spec replay passes with every assertion unchanged and zero retries.
  - [x] CI browser-shard-4: await rendered initial presence before unchanged viewer-lock checks; independent workspace/folder per case removes inherited DOCX state. Full spec passes 3/3 with one worker and zero retries.
  - [x] CI browser-shard-4 chat drag: controlled late workspace hydration reproduced exact x=964.8125; await workspace identity before dragging. Probe removed; chat spec 12/12 and all three touched browser specs 16/16 pass with four workers, zero skips/retries, and original assertions unchanged.
  - [x] CI container security: pin zlib 1.3.2-r1 in the browser runner; both embedded browser/video probes pass, and the rebuilt image passes the unchanged Trivy gate with zero findings.
  - [x] CI4 organization deletion: a held draft response reproduces the remaining-row failure; share the pending draft identity and remove the duplicate direct-create fallback. Original deletion assertion now runs after a positive loaded-list assertion in the owned fixture workspace.
  - [x] CI4 organization presence: an old HTTP response reproduces the one-peer-only display after a newer SSE update; revision fencing preserves newer state. Controlled regression and all three CI4 specs pass together 20/20, four workers, zero skips/retries; the exact-object gate also passes in the final 36-case qualification.
  - [x] CI4 session-switch diagnosis: original spec passes alone and with the other CI4 specs; event probe removed. Exact CI cause remains unproven, so no speculative source or assertion change is retained.
  - [x] UI typecheck passes with zero errors/six warnings; lint passes. Final 36-case qualification exposed a session-info 40001/HTTP 500 and concurrent magic-link provisioning 40001/HTTP 503; both original UI race regressions pass.
  - [ ] Remove activity writes from session-validation completions and fence account-provisioning snapshots against unrelated writers; preserve the existing three attempts and deadlines, then repeat scoped API/browser qualification.
  - [ ] Open one ready PR with BRANCH.md body and monitor CI until green; do not merge.
  - [x] `make down-volumes`; report `.tmp/rv/a4-followups.md` with validation and review evidence, CI handoff pending.
