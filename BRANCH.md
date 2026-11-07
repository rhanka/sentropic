# Feature: A-LIVE W3 — QualifiedSupervisor transport (M3-SUP)

## Objective
- [ ] Implement the trusted `QualifiedSupervisor` transport of the alive enablement plan (W3, r3.5) per A-LIVE v2 §8.1/§8.3 and the W2 contract §2: signed bounded frames over worker ingress :5173, monotonic fencing, process-tree termination, bounded staging, atomic projection, read-only dependency materialization, offline install with staged tarballs, trusted output snapshot and candidate sealing. Code only; merge and activation wait for the GB4-P go (A-LIVE §10).

## Scope / Guardrails
- [x] Wagon branch `feat/alive-w3` from origin/main, worktree `tmp/worktrees/alive-w3`, no PR; the train integration lane merges it.
- [x] ENV=test-alive-w3; never ENV=dev; make-only, Docker-first; no Python; no image build while the host disk is above 90%.
- [x] No version bump, lock, fixture or manifest regeneration (OPTIM 2026-11-03); scoped local tests only, full suites in the train CI.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/supervisor-channel.ts`
  - `api/src/services/artifacts/live/supervisor.ts`
  - `api/src/services/artifacts/live/supervisor-frame.ts`
  - `api/src/services/artifacts/live/supervisor-transfer.ts`
  - `api/src/services/artifacts/live/supervisor-install.ts`
  - `api/src/services/artifacts/live/recipes.ts` (INSTALL_RECIPE offline only, W2 §2)
  - `api/src/services/artifacts/live/README.md`
  - `api/tests/unit/artifacts-live/supervisor*.ts` (tests and the shared fake pod)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`, `apps/**`, `deploy/**`, `api/drizzle/**`
  - `api/src/services/artifacts/live/{pods,service,worker,ports,records,controller}.ts` (sibling lanes W4/W7/W8/pod-4live)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none.

## Feedback Loop
- [ ] Open questions for W4/W7/W8/W9 recorded in `.tmp/rv/alive-W3-W7.md`; no invented cross-lane contract.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: lane W3 of the parallel alive plan; one wagon among W1-W11, merged by the train integration lane.

## UAT Management (in orchestration context)
- [x] Wagon: no UAT; branch pushed with scoped tests green locally; no PR, no CI polling.

## Plan / Todo (lot-based)
- [x] Lot 0: plan r3.5, A-LIVE v2 §3.2/§8.1/§8.3/§8.4 and W2 contract read; previous uncommitted draft replaced (it trusted pod self-attestation of relay denial and pushed no bytes).
- [x] Lot 1: signed bounded frame (Ed25519, public key for the pod spec) and bounded transfer/snapshot reader, tests first.
- [x] Lot 2: `createSupervisorTransport` implementing every `QualifiedSupervisor` method, tests first.
- [x] Lot 3: offline clean install over the transport (tarballs staged into the pod npm cache, `npm ci --offline`), tests first.
- [ ] Lot 4: README transport section; scoped tests and typecheck green; branch pushed.
