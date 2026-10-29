# Feature: fix(ci): enforce lockfile-exact installations

## Objective
- [ ] Prevent CI and Make installs from selecting registry versions outside committed locks.

## Scope / Guardrails
- [x] Branch `fix/ci-lockfile-installs` from `origin/main`; worktree `tmp/ci-lockfile-installs`.
- [x] Make only, Docker under the packet flock, no Python; `ENV=test-ci-lockfile` last.
- [x] API 9060, UI 5260, Maildev 1160; no application services required.
- [x] Preserve installed-consumer tarball qualification and pin its registry dependencies.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `Makefile`
  - `scripts/**`
  - `tools/**`
  - `packages/**/tests/**`
  - `packages/artifacts/probe/**`
  - `packages/**/scripts/**`
  - `packages/live-speech/*.sh`
  - `packages/live-speech/*.mk`
  - `packages/cowork-desktop/packaging/**`
  - `.security/**`
  - `.github/workflows/**`
  - `**/Dockerfile*`
  - `docker-compose*.yml`
  - `apps/**/Dockerfile*`
  - `e2e/npm-toolchain/**`
- **Forbidden Paths (must not change in this branch)**:
  - `.cursor/rules/**`
  - `api/src/**`
  - `ui/src/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`

## Feedback Loop
- [x] Initial isolated tool installer requires a committed profile and invokes npm ci.
- [x] BRLOCK-EX1: owner explicitly requests Make/CI install fixes; change Makefile, workflow and container install commands only; rollback by reverting this branch.

## AI Flaky tests
- [x] No flaky allowance; exact-head CI success required.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; author codex / gpt-6.1-sol / high.

## UAT Management (in orchestration context)
- [x] Tooling/security change; no UI, Chrome or VSCode UAT surface.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read rules and lock incident evidence; mechanical branch check passed.
  - [x] Inventory Make, CI, scripts, Docker and installed-consumer paths.
- [x] **Lot 1 — Locked tool and workspace installs**
  - [x] Freeze 50 isolated tool profiles with exact transitive versions and integrity.
  - [x] Remove container install fallbacks and implicit executable downloads.
  - [x] Include the new API and E2E tool lock inputs in content-addressed image versions.
  - [x] Freeze historical consumer closures for auth-hono 0.15.0, mesh 0.19.2/0.21.2, gateway 0.18.0 and cluster-mesh 0.23.2.
  - [x] Commit installation graphs and replace live tool resolution.
  - [x] Preserve isolated builds and tarball consumers.
  - [x] Guard against unlocked npm/npx resolution, including regression fixtures.
- [x] **Lot 2 — Security evidence**
  - [x] Record fixed finding and coverage in security notes/register.
- [ ] **Lot 3 — Validation and delivery**
  - [x] Full cluster-mesh suite: 1,414 pass; installed stateful/artifacts consumer: 16 pass; llm-mesh typecheck/lint and gateway auth consumers: 3 pass.
  - [x] Cluster-mesh typecheck, 17 packaging preparation regressions and seven install guard tests pass.
  - [x] Published-consumer qualification: 18 tests pass; manifest, security and CI wiring contracts: 219 tests pass.
  - [x] Diff review preserves API runtime npm removal and distinguishes executable checks from npx execution.
  - [ ] Run guard, cluster-mesh tests/typecheck, representative package and consumer checks.
  - [ ] Review changed install paths and run mechanical scope check before each commit.
  - [ ] Stop test environment with `make down`.
  - [ ] Create draft PR to main from this plan; CI completed/success on exact head.
