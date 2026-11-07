# Feature: A-LIVE W4 — pod bootstrap (M3-SUP, no shell, no exec)

## Objective
- [ ] Implement the trusted worker pod bootstrap of the alive enablement plan (W4, r3.9) per A-LIVE v2 §8.1/§8.3, Amendment 1 §3 and the W2 static-deny contract: Ed25519 verification of every W3 frame with the SPKI public key from the pod spec, replay window, monotonic pod-bound fence, the :5173 listener (supervisor channel plus live HTTP/HMR to 127.0.0.1:5174 in the live phase only), fixed recipes with a zero-built env, offline install from staged tarballs, in-pod pre-bundle, process-group termination and the 30-minute liveness exit. Code only; merge and activation wait for the GB4-P go (A-LIVE §10).

## Scope / Guardrails
- [x] Wagon branch `feat/alive-w4` from origin/main, worktree `tmp/worktrees/alive-w4`, no PR; the train integration lane merges it.
- [x] ENV=test-alive-w4; never ENV=dev; make-only, Docker-first; no Python; no image build while the host disk is above 90%.
- [x] No version bump, lock, fixture or manifest regeneration (OPTIM 2026-11-03); scoped local tests only, full suites in the train CI.
- [x] W3 wire format (`feat/alive-w3`) applied exactly; no new supervisor op or host file.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `api/src/services/artifacts/live/bootstrap*.ts`
  - `api/src/services/artifacts/live/recipes.ts` (offline install, loopback Vite, pre-bundle, NODE_OPTIONS)
  - `api/tests/unit/artifacts-live/bootstrap*.ts`
  - `api/tests/unit/artifacts-live/recipes.test.ts`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/**`, `apps/**`, `deploy/**`, `api/drizzle/**`
  - `api/src/services/artifacts/live/{pods,service,worker,ports,records,controller}.ts` and `supervisor*.ts` (sibling lanes W3/W7/W8/pod-4live)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none.

## Feedback Loop
- [x] Open questions for W3/W7/W9/pod-4live recorded in `.tmp/rv/alive-W3-W7.md`; no invented cross-lane contract.

## AI Flaky tests
- [x] No flaky allowance, timeout increase or new skip.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [x] **Multi-branch**
- [x] Rationale: lane W4 of the parallel alive plan; one wagon among W1-W11, merged by the train integration lane.

## UAT Management (in orchestration context)
- [x] Wagon: no UAT; branch pushed with scoped tests green locally; no PR, no CI polling.

## Plan / Todo (lot-based)
- [x] Lot 0: plan r3.9, W2 contract, A-LIVE Amendment 1, s-archi review `w4-alive-w4-6b822a6f` and the W3 frame protocol read; untracked HMAC draft (`bootstrap.ts`, secret in the pod, port 5174) discarded.
- [x] Lot 1: recipes (offline install, loopback Vite, pre-bundle driver, host-owned NODE_OPTIONS), tests first.
- [x] Lot 2: frame verification, replay window, pod-bound fence and liveness lease, tests first.
- [x] Lot 3: W3 transfers (`put` + commit) for stage, overlay, dependencies and install, tests first.
- [x] Lot 4: processes (`dev` with pre-bundle, `build`, `snapshot`, process-group termination), tests first.
- [ ] Lot 5: :5173 listener and pod entry (`createBootstrapSource`), tests first; scoped tests and typecheck green; branch pushed.
