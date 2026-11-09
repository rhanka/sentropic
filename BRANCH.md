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
  - `packages/cluster-mesh/src/modules/catalog.ts`
  - `packages/cluster-mesh/tests/modules/topology-ranges.spec.ts`
  - `packages/cluster-mesh/tests/modules/registry.spec.ts`
  - `packages/cluster-mesh/tests/packaging/optional-install.spec.ts`
  - `packages/cluster-mesh/tests/packaging/tuple-skew.spec.ts`
  - `packages/cluster-mesh/tests/packaging/skew-invariants.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `packages/llm-mesh/src/node/cli/enroll-cli.ts`
  - `packages/llm-mesh/src/node/cli/enroll-args.ts`
  - `packages/llm-mesh/src/node/cli/enroll-command.ts`
  - `packages/llm-mesh/src/node/cli/node-process.d.ts`
  - `packages/llm-mesh/src/node/keyring/encrypted-file-keyring.ts`
  - `packages/llm-mesh/tests/node/enroll-cli-testkit.ts`
  - `packages/llm-mesh/tests/node/enroll-cli-enroll.test.ts`
  - `packages/llm-mesh/tests/node/enroll-cli-probe.test.ts`
  - `packages/llm-mesh/tests/decision-public-surface.test.ts`
  - `packages/llm-mesh/package.json`
  - `packages/llm-mesh/CHANGELOG.md`
  - `packages/llm-mesh/README.md`
  - `packages/llm-gateway/package.json`
  - `packages/cluster-mesh/package.json`
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
- [x] BRENROLL-EX1: root lockfile follows the `@sentropic/llm-mesh` 0.33.0 to 0.34.0 bump (version strings only, regenerated via make). Impact: lockfile only. Rollback: revert with the bump.
- [x] BRENROLL-EX2: admit the 0.34 line in `packages/llm-gateway/package.json` (`|| ^0.34.0`) and `packages/cluster-mesh/package.json` (`<0.35.0`), range strings only (follows 3b9626d35). The sibling lane `feat/llm-mesh-lot1-custodian-refresh` carries the identical cluster-mesh range value with its own dev.20 release; rebase takes either side. Impact: range strings only. Rollback: revert with the bump.
- [x] BRENROLL-EX3: align the hardcoded `LLM_MESH_RANGE` in `packages/cluster-mesh/src/modules/catalog.ts` (`<0.34.0` to `<0.35.0`, one line) with the admitted peer range, bump `@sentropic/llm-gateway` 0.22.4 to 0.22.5 (patch, precedent 143392cea) and `@sentropic/cluster-mesh` 0.26.0-dev.19 to 0.26.0-dev.21 (sibling lane owns dev.20), and update the six cluster-mesh specs asserting the old boundary (admit 0.34.0, refuse 0.35.0), and sync the `selected` fixture tuple (precedents 6cc8c7a5e, 8c2e210d4), plus root `package-lock.json` regenerated via `make lock-root` (workspace version strings only, BRENROLL-EX1 pattern). Reason: CI evidence on head dc09c4c28 (run 42662913703) — every api-sut container exits 1 with `ClusterMeshTopologyError` (installed mesh 0.34.0 vs required `<0.34.0`), and package-candidates demands a gateway bump for the widened range (143392cea proves the bumpGate requires it; EX2's no-bump reading was wrong). Impact: mesh coherence restored, no API change. Rollback: revert with the range.

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
- [x] **Lot 0 — Baseline and constraints**
  - [x] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
  - [x] Confirm worktree `tmp/worktrees/llm-mesh-enroll-cli` on branch `feat/llm-mesh-enroll-cli` from `origin/main`.
  - [x] Confirm `muse-code.ts`, `muse-runtime-client.ts`, `facade.ts`, `encrypted-file-keyring.ts` contracts on `origin/main`.
  - [x] Lot gate:
    - [ ] `make typecheck-llm-mesh` + `make lint-llm-mesh` baseline on the untouched tree.
- [x] **Lot 1 — Enroll CLI plus env-key keyring**
  - [x] Extend `EncryptedFileKeyring` with an explicit master-key override (backward compatible, no behavior change by default).
  - [x] Add `src/node/cli/enroll-cli.ts` (`enroll` prints only verification URL plus user code plus expiry, then persists; `probe` prints status plus latency plus usage only; secrets never printed; typed exit codes).
  - [x] Add `bin` entry `llm-mesh-enroll` in `packages/llm-mesh/package.json`.
  - [x] Support `muse-code` first, generic device-flow shape for other providers.
  - [x] Lot gate:
    - [x] `make typecheck-llm-mesh` + `make lint-llm-mesh` green.
- [x] **Lot 2 — Tests with stubbed fetch**
  - [x] Add `packages/llm-mesh/tests/node/enroll-cli-testkit.ts`, `enroll-cli-enroll.test.ts`, `enroll-cli-probe.test.ts`: device happy path, user-code-only output, key-by-env-name, no secret in stdout/stderr, probe error mapping (402 `billing_not_configured` flagged as the non-seat `muse.ts` path).
  - [x] Lot gate:
    - [x] Scoped run `make test-llm-mesh SCOPE=tests/node/enroll-cli-enroll.test.ts ENV=test-llm-mesh-enroll` plus probe file (3 plus 3 green).
- [x] **Lot 3 — Version, README, changelog**
  - [x] Bump `@sentropic/llm-mesh` minor (new public `bin` surface) above npm latest, update `CHANGELOG.md`.
  - [x] Add a short English README section with the exact immo detection keyring commands.
  - [x] Regenerate lockfiles via make.
  - [x] Lot gate:
    - [x] `make typecheck-llm-mesh` + `make lint-llm-mesh` green.
- [x] **Lot 4 — CI coherence fix (run 42662913703 evidence)**
  - [x] Align hardcoded `LLM_MESH_RANGE` in `packages/cluster-mesh/src/modules/catalog.ts` with the admitted peer range.
  - [x] Bump `packages/llm-gateway/package.json` 0.22.4 to 0.22.5 and `packages/cluster-mesh/package.json` 0.26.0-dev.19 to 0.26.0-dev.21.
  - [x] Update the five cluster-mesh specs asserting the old literal (admit 0.34.0, refuse 0.35.0).
  - [x] Declare BRENROLL-EX3 with CI log evidence and precedent correction.
  - [x] Sync the `selected` fixture tuple (package.json plus lock) to mesh 0.34.0, gateway 0.22.5, dev.21 (registry tarball integrity stays for the train refresh post-publish; no spec asserts it).
  - [x] Lot gate:
    - [x] `make typecheck-cluster-mesh` green.
    - [x] Scoped `make test-cluster-mesh SCOPE=tests/packaging/tuple-skew.spec.ts ENV=test-llm-mesh-enroll` green (21 passed, 2 skipped).
    - [x] `make test-cluster-mesh SCOPE=tests/packaging/prepare-artifacts.spec.ts ENV=test-llm-mesh-enroll` green (20 passed).
    - [x] `make test-cluster-mesh SCOPE=tests/packaging/artifacts-tuple.spec.ts ENV=test-llm-mesh-enroll` green (5 passed, 3 skipped).
    - [x] `make test-cluster-mesh SCOPE=tests/modules/registry.spec.ts ENV=test-llm-mesh-enroll` green (51 passed).
    - [x] Scoped topology-ranges (20 passed) plus speech-peer (18 passed) green.
    - [x] Regenerated lockfiles via `make lock-root`.
- [ ] **Lot N — Final validation**
  - [x] Typecheck and lint.
  - [x] Retest llm-mesh scoped plus full `make test-llm-mesh ENV=test-llm-mesh-enroll`.
  - [x] Bumped `packages/llm-mesh/package.json` version above npm latest.
  - [ ] Final gate step 1: create PR with `BRANCH.md` text as PR body.
  - [ ] Final gate step 2: run and verify branch CI on that PR, keep it green without rerun or skip.
  - [ ] Write the French report to `.tmp/rv/llm-mesh-enroll-cli.md` with the exact commands.
