# Feature: A4 runtime launcher runs through its ConfigMap symlink

## Objective
- [x] `deploy/k8s/overlays/preprod/a4-runtime/launch.mjs` is mounted from ConfigMap `sentropic-a4-runtime`, where `/run/cm-runtime/launch.mjs` is a `..data` symlink. Node resolves the main module to its real path, so the guard `import.meta.url === pathToFileURL(process.argv[1])` was false and the launcher exited 0 without starting the API, the IdP or the custodian (observed in sentropic-restore-a4 on 2026-11-08). Compare real paths instead.

## Scope / Guardrails
- [x] Branch fix/a4-runtime-launcher-symlink from origin/main ad3be44e7; worktree tmp/worktrees/a4-launcher-fix; ENV=test-a4-launcher.
- [x] Make only; no Python, no attribution trailers, no CI skips or reruns.
- [x] No change to HMAC composition, entrypoints or command vectors.
- [x] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `deploy/k8s/overlays/preprod/a4-runtime/launch.mjs`
  - `deploy/ci/preprod-a4/launch-symlink.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.track/**`
  - `api/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [x] `attention`: without this fix the authorized A4 wire would leave API/IdP in CrashLoopBackOff (container exits 0) and the custodian Pod Completed.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one-line runtime fix with its test.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Launcher main-module guard**
  - [x] `isMain(url, argv1)` compares `import.meta.url` with the real path of `argv[1]`.
  - [x] `deploy/ci/preprod-a4/launch-symlink.test.mjs`: run the launcher through a two-level symlink; it must reach its main block (refuses without HMAC custody, exit 1).
  - [x] Lot gate (32/32): `make test-preprod-a4 ENV=test-a4-launcher`
- [ ] **Lot 2 — PR**
  - [ ] PR « fix(a4): run the A4 runtime launcher through its ConfigMap symlink », CI green on the exact head, GLM review.
