# Feature: llm-mesh enroll CLI (muse-code device flow)

## Objective
- [ ] Ship a generic Node CLI entry point in `@sentropic/llm-mesh` (`llm-mesh-enroll`) with `enroll` and `probe` for device-flow providers (muse-code first).

## Scope / Guardrails
- [ ] Scope limited to the enroll CLI, env-key keyring support, its tests, version bump and README section.
- [ ] No migration in `api/drizzle/*.sql`.
- [ ] Make-only workflow, Docker via `.tmp/packets/docker-slot.sh make ...` in the foreground only, `ENV` always last.
- [ ] Branch work in `tmp/worktrees/llm-mesh-enroll-cli`, never on root.
- [ ] Test env `ENV=test-llm-mesh-enroll`, ports `API_PORT=8925 UI_PORT=5325 MAILDEV_UI_PORT=1225`.
- [ ] Never `ENV=dev`, never `make clean-all`, no Python.
- [ ] Commits via `make commit MSG="..."` single line English, no attribution trailer, stage specific files only, max 150 lines per commit.
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- [ ] Do NOT merge: PR stays open for s-conductor.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/llm-mesh/src/node/cli/enroll-cli.ts`
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts`
  - `packages/llm-mesh/tests/node/enroll-cli.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-mesh/README.md`
  - `BRANCH.md`
  - `.tmp/rv/llm-mesh-enroll-cli.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose.dev.yml` (only if verification forces a compose change; untouched so far)
  - `.tmp/rv/compose-backup-owner.md` (French verification report, untracked)
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile` (covered by BRCBO-EX1 below)
  - `docker-compose*.yml` (covered by BRCBO-EX1 below)
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
  - `ui/**`
  - `api/**`
  - `deploy/**`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `package-lock.json`
  - `packages/llm-mesh/package-lock.json`
- **Exception process**:
  - Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.
  - Include reason, impact, and rollback strategy.
  - Mirror the same exception in this file under `## Feedback Loop` (or `## Questions / Notes` if not yet migrated).

## Feedback Loop
- [ ] BRENROLL-EX1: root lockfile follows the `@sentropic/llm-mesh` 0.33.0 to 0.34.0 bump (version string only, regenerated via make). Impact: lockfile only. Rollback: revert with the bump.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick**
- Rationale: one small generic CLI addition, one CI run.

## UAT Management (in orchestration context)
- [x] **Mono-branch**: no UI change, no UAT surface.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline and constraints**
  - [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [ ] Confirm worktree `tmp/worktrees/llm-mesh-enroll-cli` on branch `feat/llm-mesh-enroll-cli` from `origin/main`.
  - [ ] Confirm `muse-code.ts`, `muse-runtime-client.ts`, `facade.ts`, `encrypted-file-keyring.ts` contracts on `origin/main`.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh` + `make lint-llm-mesh` baseline on the untouched tree.
- [ ] **Lot 1 — Enroll CLI plus env-key keyring**
  - [ ] Extend `EncryptedFileKeyring` with an explicit master-key override (backward compatible, no behavior change by default).
  - [ ] Add `src/node/cli/enroll-cli.ts` (`enroll` prints only verification URL plus user code plus expiry, then persists; `probe` prints status plus latency plus usage only; secrets never printed; typed exit codes).
  - [ ] Add `bin` entry `llm-mesh-enroll` in `packages/llm-mesh/package.json`.
  - [ ] Support `muse-code` first, generic device-flow shape for other providers.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh` + `make lint-llm-mesh` green.
- [ ] **Lot 2 — Tests with stubbed fetch**
  - [ ] Add `packages/llm-mesh/tests/node/enroll-cli.test.ts`: device happy path, user-code-only output, key-by-env-name, no secret in stdout/stderr, probe error mapping (402 `billing_not_configured` flagged as the non-seat `muse.ts` path).
  - [ ] Lot gate:
    - [ ] Scoped run `make test-llm-mesh SCOPE=tests/node/enroll-cli.test.ts ENV=test-llm-mesh-enroll`.
- [ ] **Lot 3 — Version, README, changelog**
  - [ ] Bump `@sentropic/llm-mesh` minor (new public `bin` surface) above npm latest, update `CHANGELOG.md`.
  - [ ] Add a short English README section with the exact immo detection keyring commands.
  - [ ] Regenerate lockfiles via make.
  - [ ] Lot gate:
    - [ ] `make typecheck-llm-mesh` + `make lint-llm-mesh` green.
- [ ] **Lot N — Final validation**
  - [ ] Typecheck and lint.
  - [ ] Retest llm-mesh scoped plus full `make test-llm-mesh ENV=test-llm-mesh-enroll`.
  - [ ] Bumped `packages/llm-mesh/package.json` version above npm latest.
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run and verify branch CI on that PR, keep it green without rerun or skip.
  - [ ] Write the French report to `.tmp/rv/llm-mesh-enroll-cli.md` with the exact commands.
