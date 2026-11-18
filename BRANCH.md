# Feature: llm-mesh Muse seat lifetime
## Objective
Fix the Muse device-flow seat expiry at t+1h by treating the minted key as valid until provider rejection.
## Scope / Guardrails
- Scope limited to packages/llm-mesh Muse enrollment, transport, service, tests, version bump.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree tmp/muse-seat-lifetime.
- Test campaigns on ENV=test-muse-seat, never on root dev.
- In every make command, ENV=<env> passed as the last argument.
- All new text in English.
## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - packages/llm-mesh/src/enrollment/muse-code.ts
  - packages/llm-mesh/src/enrollment/contracts.ts
  - packages/llm-mesh/src/enrollment/muse.ts
  - packages/llm-mesh/src/service/local-account-transport-service.ts
  - packages/llm-mesh/src/service/custodian-refresh.ts
  - packages/llm-mesh/src/transport/muse-runtime-client.ts
  - packages/llm-mesh/tests/service/local-account-transport-service-muse.test.ts
  - packages/llm-mesh/tests/service/custodian-refresh.test.ts
  - packages/llm-mesh/tests/transport/muse-runtime-client.test.ts
  - packages/llm-mesh/tests/enrollment/muse-device-flow-lifetime.test.ts
  - packages/llm-mesh/CHANGELOG.md
  - packages/llm-mesh/package.json
  - packages/llm-mesh/tests/decision-public-surface.test.ts
  - packages/cluster-mesh/tests/fixtures/train.ts
  - packages/cluster-mesh/tests/packaging/fixtures/selected/package.json
  - packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json
  - package-lock.json
  - BRANCH.md
- **Forbidden Paths (must not change in this branch)**:
  - Makefile
  - docker-compose*.yml
  - .cursor/rules/**
  - plan/NN-BRANCH_*.md (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None
- **Exception process**:
  - Declare exception ID BRxx-EXn in ## Feedback Loop before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under ## Feedback Loop (or ## Questions / Notes if not yet migrated).
## Feedback Loop
- [ ] attention: origin/main carries a stale BRANCH.md from fix-muse-headers, replaced here for this branch scope.
## AI Flaky tests
- [ ] No flaky accepted without same-commit success + sign-off.
## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single package fix, one test cycle)
## Plan / Todo (lot-based)
- [ ] Lot 0 - Baseline and constraints
  - [ ] Read rules and confirm worktree on fix/llm-mesh-muse-seat-lifetime.
  - [ ] Capture diagnosis with file:line evidence.
  - [ ] Define test env ENV=test-muse-seat with API_PORT=9186 UI_PORT=5386 MAILDEV_UI_PORT=1286.
- [ ] Lot 1 - Failing tests then fix
  - [ ] Add enrollment lifetime test (minted key ignores OAuth expires_in, persists device token).
  - [ ] Add service test (unknown expiry stays ready, re-mint on rejection path).
  - [ ] Add transport test (401/403 carries auth code).
  - [ ] Implement fix in src files.
  - [ ] Lot gate:
    - [ ] Scoped make test-llm-mesh runs green.
- [ ] Lot 2 - Version and release alignment
  - [ ] Bump 0.38.2 to 0.38.3 with CHANGELOG entry.
  - [ ] Align root lock and train fixtures.
  - [ ] Lot gate:
    - [ ] Scoped make test-llm-mesh runs green.
- [ ] Lot N - Final validation
  - [ ] Typecheck and Lint
  - [ ] Retest scoped suites
  - [ ] Bumped affected packages/llm-mesh/package.json version (semver) for every package whose src/** changed in this branch.
  - [ ] Final gate step 1: create/update PR using BRANCH.md text as PR body (source of truth).
  - [ ] Final gate step 2: run/verify branch CI on that PR and resolve remaining blockers.
  - [ ] Final gate step 3: once UAT + CI are both OK, commit removal of BRANCH.md, push, and merge.
