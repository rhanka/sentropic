# Feature: Artifacts reconcile pending builds (0.2.25)

## Objective
- [ ] Add a generic `reconcilePendingBuilds` in `packages/artifacts/src/live-host` that polls the builder `GET /v1/builds/:artifactId/:jobId` for host jobs stuck in `build_pending`/`building` and applies only allowed transitions through the package stores, with host ports for the job store and the status client.

## Scope / Guardrails
- [ ] Scope limited to the generic reconcile in `@sentropic/artifacts/live-host`, its unit tests, the 0.2.25 release files and the report.
- [ ] No migration in `api/drizzle/*.sql`.
- [ ] Make-only workflow, Docker via `.tmp/packets/docker-slot.sh make ...` in the foreground only, `ENV` always last.
- [ ] Branch work in `tmp/worktrees/reconcile-pending-builds`, never on root.
- [ ] Test env `ENV=test-reconcile-builds`, ports `API_PORT=8907 UI_PORT=5307 MAILDEV_UI_PORT=1207`.
- [ ] Never `ENV=dev`, never `make clean-all`, no Python.
- [ ] Commits via `make commit MSG="..."` single line English, no attribution trailer, stage specific files only, max 150 lines per commit.
- [ ] No immo code in the package: generic ports only, immo wires them (wiring listed in `.tmp/rv/reconcile-pending-builds.md`).
- [ ] Retain the existing BRLOCK-EX1 policy reference: owner=CI maintainers; review_by=2026-11-30T00:00:00Z; bounded tooling exceptions and removal trigger remain in `.security/ci-lockfile-policy.json`.
- [ ] Do NOT merge: PR stays open for s-conductor.

## Branch Scope Boundaries (MANDATORY)
- [ ] **Allowed Paths (implementation scope)**:
- [ ] `packages/artifacts/src/live-host/reconcile.ts`
- [ ] `packages/artifacts/src/live-host/index.ts`
- [ ] `packages/artifacts/tests/live-host-reconcile.test.ts`
- [ ] `packages/artifacts/tests/fixtures/live-host-reconcile.ts`
- [ ] `packages/artifacts/package.json`
- [ ] `packages/artifacts/src/mcp-core.ts`
- [ ] `packages/artifacts/CHANGELOG.md`
- [ ] `BRANCH.md`
- [ ] `.h2a/reviews/reconcile-pending-builds-argon.md`
- [ ] `.tmp/rv/reconcile-pending-builds.md`
- [ ] **Forbidden Paths (must not change in this branch)**:
- [ ] `Makefile`
- [ ] `docker-compose*.yml`
- [ ] `.cursor/rules/**`
- [ ] `plan/NN-BRANCH_*.md` (except this branch file)
- [ ] `ui/**`
- [ ] `api/**`
- [ ] `deploy/**`
- [ ] `.track/**`
- [ ] **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
- [ ] `package-lock.json`
- [ ] `api/package-lock.json`
- [ ] `packages/cluster-mesh/tests/packaging/fixtures/selected/**`
- [ ] `packages/cluster-mesh/tests/packaging/artifacts-tuple.spec.ts`
- [ ] `api/src/services/mcp/cluster-registry.ts`
- [ ] `api/tests/api/app-mcp-installed.test.ts`
- [ ] `api/tests/api/app-mcp-registry.test.ts`
- [ ] `api/tests/api/mcp-workspaces-list-dispatch.test.ts`
- [ ] `.github/workflows/**`
- [ ] **Exception process**:
- [ ] Declare exception ID `BRxx-EXn` in `## Feedback Loop` before touching any conditional/forbidden path.

## Feedback Loop
- [ ] `attention` BRRP-EX1: root and api lock workspace entries follow artifacts 0.2.25 (version strings only), as BRLW-EX1 did. Impact: lockfiles only. Rollback: revert with the bump.
- [ ] `attention` BRRP-EX2: the cluster-mesh selected packaging fixture follows artifacts 0.2.25 (version strings plus the integrity pin of the locally packed `make pack-artifacts` archive), mirrored in `artifacts-tuple.spec.ts`, as BRLW-EX2 did. Impact: test fixtures only. Rollback: revert with the bump.
- [ ] `attention` BRRP-EX3: the 0.2.25 release repins the APP-P1 manifest digest through its version field only (as the 0.2.24 release did): `api/src/services/mcp/cluster-registry.ts` digest + comment and the three `api/tests/api/*.test.ts` version/digest assertions. Impact: version strings and pins only. Rollback: revert with the bump.
- [ ] No scope exception beyond BRRP-EX1/BRRP-EX2/BRRP-EX3.

## AI Flaky tests
- [ ] Acceptance rule:
- [ ] Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
- [ ] Non-systematic means at least one success on the same commit and same command.
- [ ] Never amend tests with additive timeouts.
- [ ] If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
- [ ] Capture explicit user sign-off before merge.

## Orchestration Mode (AI-selected)
- [ ] **Mono-branch + cherry-pick**
- [ ] Rationale: one package feature, one test cycle, one PR, no merge.

## UAT Management (in orchestration context)
- [ ] **Mono-branch**: no user-visible surface (package API only), no UAT.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
- [ ] Read `rules/MASTER.md`, `rules/workflow.md`, `rules/testing.md`, `.tmp/packets/COMMON-RULES.md`.
- [ ] Worktree `tmp/worktrees/reconcile-pending-builds` on branch `feat/artifacts-reconcile-pending-builds` from `origin/main` (`d20f5af11`).
- [ ] Ports: `API_PORT=8907 UI_PORT=5307 MAILDEV_UI_PORT=1207`, `ENV=test-reconcile-builds`.
- [ ] Confirm pre-bump: `npm view @sentropic/artifacts version` is `0.2.24`, target `0.2.25`.
- [ ] Validate scope boundaries and declare BRRP-EX1/BRRP-EX2 before touching locks/fixtures.
- [ ] **Lot 1 — Generic reconcile in live-host**
- [ ] `packages/artifacts/src/live-host/reconcile.ts`: `reconcilePendingBuilds` sweep (older-than threshold, bounded concurrency, never deletes) plus `reconcilePendingBuild` single-job entry for the `live_status` / `git_publish` / `artifacts_get` read paths.
- [ ] Host ports as interfaces: pending-job store read/update, builder status client (`GET /v1/builds/:artifactId/:jobId` shape `{jobId, state: build_pending|published|build_failed, code?, reason?, releaseId?}`), bindings via `GitBindingStore` get/write, optional receipt read via `HostLedger.find`.
- [ ] Allowed transitions only: job `build_pending`/`building` to `build_failed` (`+code`/`+reason`) or `published` (`+releaseId` from the handoff/receipt path, never invented); binding `build_pending` to `build_failed` (`server/git-bindings.ts:51`, version CAS); idempotent; typed errors.
- [ ] Export from `packages/artifacts/src/live-host/index.ts`.
- [ ] `packages/artifacts/tests/live-host-reconcile.test.ts`: stale failure applies job `build_failed` and binding `build_failed`; builder `published` with receipt applies job `published` with the receipt `releaseId` and never invents one; still-pending stays; malformed status is skipped; terminal jobs are never regressed; concurrent sweep is bounded.
- [ ] Scoped run: `docker-slot.sh make test-artifacts SCOPE=tests/live-host-reconcile.test.ts ENV=test-reconcile-builds`.
- [ ] Lot gate: `make typecheck-artifacts` + `make lint-artifacts` via `docker-slot.sh`, then `make scope-check`.
- [x] **Lot 2 — Release 0.2.25**
- [x] Bump `packages/artifacts/package.json` to `0.2.25` (strictly above npm `0.2.24`, re-check after any rebase), `ARTIFACTS_PROVIDER_VERSION` follows (BRRP-EX3).
- [x] APP-P1 manifest digest repin through the version field only (BRRP-EX3): `51e82e14...` computed in-suite, corroborated via the mesh re-export.
- [x] `packages/artifacts/CHANGELOG.md` entry for `0.2.25`.
- [x] BRRP-EX1: root and `api` lock workspace entries follow `0.2.25`.
- [x] BRRP-EX2: cluster-mesh selected fixture follows `0.2.25` (three deterministic `make pack-artifacts` runs, same sha256 `83bf5956...`, sha512 repin), mirrored in `artifacts-tuple.spec.ts`.
- [x] Validate with the publishable-manifests make target and `make pack-artifacts`: `PASS @sentropic/artifacts@0.2.25 mode=block`. `check-publishable-manifest` cannot run locally (target never mounts `/workspace`, pre-existing, out of scope); CI runs it.
- [x] Full `docker-slot.sh make test-artifacts ENV=test-reconcile-builds` PASS (101 files, 1008 tests).
- [x] **Lot 3 — PR, CI, review**
- [x] Open PR with this `BRANCH.md` as body, push branch to origin (PR #979).
- [x] Rebase on `origin/main` (`ec3c0bcc8`, then `f69bc2a03`), Post-Rebase Gate holds (`0.2.25` above npm `0.2.24`).
- [ ] CI green on the exact head (no rerun, no skip, no `[skip ci]`): `validate-cluster-mesh (source|lazy)` failed on the fixture root deps (fixed); `prepare-artifacts.spec.ts` is the durable collateral. No run started for the previous head (lost synchronize event); this push re-triggers a fresh `pull_request` run.
- [ ] Review: Argon high unavailable (agy 429, resets in ~106h), vibe GLM fallback 402 exhausted; Muse Wonder single-leg review at `.h2a/reviews/reconcile-pending-builds-argon.md` verdict REQUEST_CHANGES (F1 store-error containment, F2 binding-not-pending, F3 missing pins, F4-F7 cleanups); addressing now, second leg still missing.
- [ ] Do NOT merge.
- [ ] **Lot N — Final validation and report**
- [ ] Post-rebase gate: package version still above npm latest.
- [ ] `make scope-check` clean on the final head.
- [ ] Write `.tmp/rv/reconcile-pending-builds.md` in French with the exact wiring immo must add.
- [ ] End with `make down-volumes ENV=test-reconcile-builds`.
