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
  - `.dockerignore`
  - `packages/cowork-desktop/package.json`
  - `package-lock.json`
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
  - `No additional conditional paths`

## Feedback Loop
- [x] Initial isolated tool installer requires a committed profile and invokes npm ci.
- [x] CI run 41008419926: Docker context omitted locked API installer inputs; a real scratch COPY regression fails before the exact .dockerignore re-inclusions and passes after. Shared Node tag migration is dated debt; new guard targets pin their own digest, preserving IdP and immutable L5 verification.
- [x] BRLOCK-EX1: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; authorized Make/CI/container installs and Docker context, tool/consumer runners and locks, packaging probes/manifests, security evidence and regression tests within Allowed Paths; root lock allowed only for the cowork-desktop manifest repair; remove on PR closure; rollback by reverting this branch.

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
  - [x] Run guard, cluster-mesh tests/typecheck, representative package and consumer checks.
  - [ ] Review changed install paths and run mechanical scope check before each commit.
  - [x] Stop test environment with `make down`; no application services were started.
  - [ ] Create draft PR to main from this plan; CI completed/success on exact head.
- [ ] **Lot 4 — Muse Wonder review changes**
  - [x] R1: reproduce the missing API filters; cover API and E2E content-hash inputs.
  - [ ] R2: rebase preserving main and lockfile intent; Post-Rebase Gate; exact-head CI success.
  - [x] R3: cover npm aliases and flags-before-verb; declare scan boundaries; new bypass fixtures observed red then green.
  - [x] R4: bind scanned shell/Make/Docker/JS tool calls to profiles and consumer literal versions to the frozen closure; require historical closures; removal and typo regressions observed red then green.
  - [x] Post-Rebase Gate: zero packages with src changes relative to origin/main; no publication version bump applies.
  - [x] Preserve main's precise image-filter contract and require a review date on the pending finding.
  - [x] Exact-head CI reproduced cowork-desktop's forbidden file dependencies after its packaging script became selected; repair only its manifest and root lock; pre-bump registry read: desktop 0.2.0, bridge 0.1.1, chat-ui 0.34.1.
  - [x] Cowork-desktop 0.2.1 packed-manifest guard passes; root lock retains only the generated workspace metadata delta; immutable L5 verifier and IdP selftest pass unchanged.
  - [x] Existing gateway auth-subpath consumer tests reproduce the cold-workspace absolute-path failure; derive the locked runner from sourceRoot so isolated and normal workspaces use the same consumer.
  - [x] R5: admit only explicitly named candidate archives and manifest file specs; sibling-admission regression observed red then green.
  - [x] R6: assign exception owners, UTC review dates, removal triggers and accurate scope; expiry regression observed red then green.
  - [x] R7: track isolated catalog SCA coverage separately with owner, scanner and review date; contract observed red then green.
  - [x] R8: digest-pin touched runtime images; pinning regression observed red then green.
