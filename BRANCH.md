# Feature: A-LIVE W3 — QualifiedSupervisor transport (M3-SUP)

## Objective
- [ ] Implement the trusted `QualifiedSupervisor` transport of the alive enablement plan (W3, r3.5) per A-LIVE v2 §8.1/§8.3 and the W2 contract §2: signed bounded frames over worker ingress :5173, monotonic fencing, process-tree termination, bounded staging, atomic projection, read-only dependency materialization, offline install with staged tarballs, trusted output snapshot and candidate sealing. Code only; merge and activation wait for the GB4-P go (A-LIVE §10).

## Scope / Guardrails
- [x] Wagon branch `feat/alive-w3` from origin/main, worktree `tmp/worktrees/alive-w3`, no PR; the train integration lane merges it.
- [x] ENV=test-alive-w3; never ENV=dev; make-only, Docker-first; no Python; no image build while the host disk is above 90%.
- [x] No version bump, lock, fixture or manifest regeneration (OPTIM 2026-11-03); scoped local tests only, full suites in the train CI.
- [x] Depends on wagon `feat/artifacts-live-host` for the `@sentropic/artifacts/live-host` subpath; the train carries both.
- [x] Depends on wagon `feat/alive-w4` @ `128130a6d` for `recipes.ts` (`artifactEnvironment`, `buildEnvironment`, `PREBUNDLE_RECIPE`, offline `INSTALL_RECIPE`); W4 is its sole author (s-archi 16:40 FIX1).
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/supervisor-channel.ts`
  - `api/src/services/artifacts/live/supervisor.ts`
  - `api/src/services/artifacts/live/supervisor-frame.ts`
  - `api/src/services/artifacts/live/supervisor-transfer.ts`
  - `api/src/services/artifacts/live/supervisor-install.ts`
  - `api/src/services/artifacts/live/README.md`
  - `api/tests/unit/artifacts-live/supervisor*.ts` (tests and the shared fake pod)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`, `apps/**`, `deploy/**`, `api/drizzle/**`
  - `api/src/services/artifacts/live/{pods,service,ports,records,controller}.ts` (sibling lanes W4/W7/W8/pod-4live)
  - `api/src/services/artifacts/live/recipes.ts` (W4 sole author, s-archi 16:40 FIX1; no diff against origin/main)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/src/services/artifacts/live/worker.ts` (BRW3-EX1)
  - `api/tests/unit/artifacts-live/adapters.test.ts` (BRW3-EX1, BRW3-EX2)
  - `api/src/services/artifacts/live/cache.ts` (BRW3-EX2)
  - `api/src/services/artifacts/live/cache-storage.ts` (BRW3-EX2)
  - `api/tests/unit/artifacts-live/cache.test.ts` (BRW3-EX2)

## Feedback Loop
- [x] Open questions for W4/W7/W8/W9 recorded in `.tmp/rv/alive-W3-W7.md`; no invented cross-lane contract.
- [x] BRW3-EX1: s-archi correction 07/11 15:05 assigns W3 the `QualifiedSupervisor.prebundle` port and the worker call order (live config host file, pre-bundle, dev; no pre-bundle host file) with W4's `artifactEnvironment()` for pre-bundle and dev and `buildEnvironment()` for the build (s-archi 16:40 FIX1); impact: `worker.ts` interface and two worker calls plus their adapter test; rollback: revert the BRW3-EX1 commits.
- [x] BRW3-EX2: s-archi decision 07/11 15:00 (a') makes the trusted dependency cache stream (one content-addressed object per file plus a manifest, memory bounded to one file); impact: `cache.ts`, `cache-storage.ts` and their tests, receipt tree digest unchanged; rollback: revert the BRW3-EX2 commits.

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
- [x] Lot 4: README transport section; scoped tests and typecheck green; branch pushed.
- [x] Lot 5: final pass: the single `candidateDigest` of `@sentropic/artifacts/live-host` replaces `candidateManifestDigest` (tests first); immo installed tree measured against `TREE_LIMITS`.
- [x] Lot 6: decisions 07/11 15:00 and 15:05: `prebundle` op, live and build environments, HOST_FILES kept at 3 (BRW3-EX1), tests first.
- [x] Lot 7: dependency limits 65536 files, 64 MiB per file, 1 GiB total; streaming trusted cache and tarballs (BRW3-EX2), tests first.
- [x] Lot 8: README; scoped tests and typecheck green; branch pushed.
- [x] Lot 9: s-archi 16:40 FIX1: W3 drops its `recipes.ts` edits and compares pre-bundle and dev with W4's `artifactEnvironment()`, the build with `buildEnvironment()`; `cache.test.ts` takes W4's identical public `VITE_*` assertion; tests first.
- [x] Lot 10: s-archi 16:40 FIX2: op `renew {}` → `{ renewed: true }` implementing the W8 port `QualifiedSupervisor.renew` (fenced, side-effect free; the W8 controller owns the ≤ 60 s cadence), tests first.
