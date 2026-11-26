# Feature: Lot S2 systemd user adapter and publish wiring (@sentropic/local-scheduler)

## Objective
Implement Lot S2 of `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md` (§7.2): close carried S1 review items (`R2-2`, `R2-3`, `R2-4`, `R2-5`), implement `SystemdUserAdapter` (`src/systemd/systemctl.ts`, `src/systemd/index.ts`) and `./systemd` export (`n-4`), add Docker systemd CI qualification (`Dockerfile.systemd-ci`, `tests/fixtures/ci-runner.mjs`, `make test-local-scheduler-systemd-ci`), add `make qualify-local-scheduler-host`, and wire bootstrap/gated OIDC publish targets (`BR-LSCH-EX1b`, `BR-LSCH-EX2`).

## Scope / Guardrails
- Scope limited to Lot S2 of `spec/SPEC_EVOL_LOCAL_SCHEDULED_TASKS.md` §7.2 (minus CI registration items already landed in Lot S1 PR #1079), carried S1 review items (`R2-2`..`R2-5`), `./systemd` export switch (`n-4`), and declared scope exceptions `BR-LSCH-EX1b` and `BR-LSCH-EX2`.
- §4 consumer contract (`src/index.ts`, `src/runner-public.ts`, types, signatures, witness v1, error codes) is frozen and consumed by `h2a`: conform verbatim, never modify it.
- Make-only workflow, Docker-first (`ENV=local-scheduler-s2` passed last; never `ENV=dev`; never `make clean-all`).
- Zero Python anywhere; zero network in `src/**`; `0700`/`0600` modes; no `/tmp` writes in `src/**`; never mutate `~/.config/systemd/user/`.
- Steady-state OIDC `publish-local-scheduler` job stays gated (not runnable) until owner attaches npm trusted publisher; never trigger `workflow_dispatch` or `npm publish` or tag or merge.
- Atomic commits under 150 lines each via selective `git add` + `make commit MSG="..."` (single-line English, zero trailers); remove `BRANCH.md` in final commit after gates pass.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/local-scheduler/**`
  - `BRANCH.md`
  - `Makefile`
  - `.github/workflows/ci.yml`
  - `scripts/ci/publishable-manifests.mjs`
  - `scripts/ci/ci-expected-results.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md`
  - `package-lock.json`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql`
  - `.github/workflows/**`
- **Exception process**:
  - `BR-LSCH-EX1b` and `BR-LSCH-EX2` declared in `## Feedback Loop` with rationale, impact, and rollback strategy.

## Feedback Loop
- `acknowledge` **`BR-LSCH-EX1b`** *(Lot S2 — `Makefile`, `.github/workflows/ci.yml`, `scripts/ci/publishable-manifests.mjs`, `scripts/ci/ci-expected-results.test.mjs`, `packages/local-scheduler/Dockerfile.systemd-ci`)*:
  - Rationale: Add `test-local-scheduler-systemd-ci`, `publish-local-scheduler`, and `publish-local-scheduler-token` Make targets (built from in-repo `Dockerfile.systemd-ci` on `$(LLM_MESH_NODE_IMAGE)`), register `local-scheduler` in `STEADY_STATE_PUBLISHERS` and `BOOTSTRAP_TARGETS` in `scripts/ci/publishable-manifests.mjs`, add `bootstrap_publish_target=local-scheduler` and `local_scheduler_publish` + gated `publish-local-scheduler` + systemd CI step in `.github/workflows/ci.yml`, and allow gated `publish-local-scheduler` in `scripts/ci/ci-expected-results.test.mjs` (the `consumer-boundaries.json` entry, `pack-local-scheduler`, `PACK_TARGETS`, and `validate-local-scheduler` job were already landed in Lot S1).
  - Impact: Editing `Makefile` and `.github/workflows/ci.yml` matches the CI `global` and `local_scheduler` filters, running the full CI matrix on the PR; `bootstrap_publish_target=local-scheduler` becomes selectable in `workflow_dispatch` (using `NPM_TOKEN`, never triggered automatically), while steady-state OIDC `publish-local-scheduler` remains gated (`false && ...`) until the owner attaches the npm trusted publisher on npmjs.com.
  - Rollback: Revert the additive Lot S2 `Makefile` targets, `packages/local-scheduler/Dockerfile.systemd-ci`, the `ci.yml` `local_scheduler_publish` filter/output, `bootstrap_publish_target` option + step, `validate-local-scheduler` systemd-ci step, `publish-local-scheduler` job + `ci-capacity-receipts.needs`, `STEADY_STATE_PUBLISHERS`/`BOOTSTRAP_TARGETS` `'local-scheduler'` entries in `scripts/ci/publishable-manifests.mjs`, and the gated-publisher clause in `scripts/ci/ci-expected-results.test.mjs`.
- `acknowledge` **`BR-LSCH-EX2`** *(Lot S2 — Docker-first exception for `make qualify-local-scheduler-host` in `Makefile`)*:
  - Rationale: Containers cannot prove host init PID namespace (`pid:[4026531836]`), real `bwrap --unshare-pid` sandbox refusal / cross-namespace lock safety, or the owner's real host systemd 259 user manager (Debian bookworm CI runs systemd 252).
  - Impact: Opt-in host qualification target only (`make qualify-local-scheduler-host`); never runs in CI; installs ephemeral runtime units only in `$XDG_RUNTIME_DIR/systemd/user/` (`runtime: true`) and asserts `~/.config/systemd/user/` byte-identical SHA-256 before and after.
  - Rollback: Remove `qualify-local-scheduler-host` target from `Makefile`.

## AI Flaky tests
- None expected; all unit and systemd CI tests use deterministic local fixtures.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single worktree `tmp/cm-release-0270` on `feat/local-scheduler-s2`)
- [ ] **Multi-branch**
- Rationale: Single cohesive Lot S2 package + CI wiring deliverable on one branch.

## UAT Management (in orchestration context)
- Not applicable to this library/adapter lane; owner host qualification (`make qualify-local-scheduler-host`) and bootstrap publish (`Owner actions #1 and #2`) remain owner-executed post-merge.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline, scope, and carried S1 review items (`R2-2`..`R2-5`)**
  - [x] Confirm branch `feat/local-scheduler-s2` from `origin/main` and run baseline `make typecheck-local-scheduler ENV=local-scheduler-s2` and `make scope-check ENV=local-scheduler-s2`.
  - [x] Fix `R2-3`: retain quarantine copy `<taskId>.lock.quarantine.<nonce>` on `unlinkSync(lockPath)` error (unlink only after successful removal or snapshot-mismatch branch) in `src/lock.ts` + failing-without-fix test in `tests/lock.spec.ts`.
  - [x] Fix `R2-2`: add `onBeforeReclaimUnlink` internal hook in `src/lock-types.ts`/`src/lock.ts` and add tests in `tests/lock.spec.ts` verifying quarantine copy exists with exact bytes/0600 before `unlink` and two concurrent reclaimers serialize via `<taskId>.lock.reclaim`.
  - [x] Fix `R2-5`: add test in `tests/lock.spec.ts` pinning `record.timeNs !== null` when both `record.timeNs` and `readSelfTimeNs()` are `null` with start-time mismatch and dead child group.
  - [x] Fix `R2-4`: add `tsconfig.test.json` and type-check `tests/**/*.ts` in `Makefile` (`typecheck-local-scheduler`) so `Equals<...>` assertions in `tests/contract.spec.ts` and `tests/health-env.spec.ts` are verified by `tsc`.

- [x] **Lot 1 — `systemd --user` wrapper and `SystemdUserAdapter` (`n-4`)**
  - [x] Implement `packages/local-scheduler/src/systemd/systemctl.ts`: safe `execFile` (`--` before variable args, bounded timeout, no `show-environment`), `probeSystemdUserAvailability`, `computeExpectedIntervalMs` (presets + `systemd-analyze calendar --iterations=8`), `probeLingerEnabled` (read-only `loginctl`), `systemctl` lifecycle and `show` property helpers.
  - [x] Implement `packages/local-scheduler/src/systemd/index.ts`: `createSystemdUserAdapter` (§4.2 exact signature), `createSystemdUserAdapterInternal` (`m-26` hostPidGuard/execFile/nowIso seam), shared `unitDir` safety (create `0700` only if absent, never `chmod` existing, uid + `0o022` check), `# Managed-By` header enforcement, `enable` (`--runtime`, `OnCalendar` restart, atomic manifest-after-enable, `m-29` `SYSTEMCTL_FAILED` rollback on update & first-install, read-only `lingerNotice`), `disable`, `status` (`ExecMainStatus=203` & two-branch `77` diagnostics `m-28(a)`, `m-28(b)` lock/skip, `m-30` env-file override), idempotent `uninstall` (`clean --what=state`, `purgeState`).
  - [x] Update `packages/local-scheduler/package.json` (`version` -> `0.2.0` for `enforce-package-bump`, `./systemd` export -> `./dist/systemd/index.js` per `n-4`), update `README.md`, and add unit tests in `tests/systemd-adapter.spec.ts` + export checks in `tests/fake-adapter-static.spec.ts`.

- [x] **Lot 2 — CI systemd container, host qualification script, and `BR-LSCH-EX1b`/`EX2` wiring**
  - [x] Add `packages/local-scheduler/tests/fixtures/ci-runner.mjs` (`m-26` trampoline), `tests/fixtures/prod-runner.mjs`, `tests/fixtures/task-ok.mjs`, `tests/fixtures/systemd-ci-suite.mjs` (testing `systemd-analyze calendar/verify` incl. `$$`/`${X}` unit, full `SystemdUserAdapter` lifecycle, `m-29` rollback, `RestrictAddressFamilies=AF_UNIX` TCP block, `UnsetEnvironment=NODE_OPTIONS`, `SuccessExitStatus=130 143`, `ExecMainStatus=203` & both `77` branches).
  - [x] Add `packages/local-scheduler/Dockerfile.systemd-ci` (`$(LLM_MESH_NODE_IMAGE)` + `systemd`, `systemd-sysv`, `dbus-user-session`, zero Python) and `packages/local-scheduler/tests/fixtures/qualify-host.mjs` (`make qualify-local-scheduler-host` script with `~/.config/systemd/user/` SHA-256 unchanged check).
  - [x] Update `Makefile` (`typecheck-local-scheduler` with `tsconfig.test.json`, `test-local-scheduler-systemd-ci`, `publish-local-scheduler`, `publish-local-scheduler-token`, `ci-capacity-publish-dry-run` `local-scheduler` case, `qualify-local-scheduler-host`), `scripts/ci/publishable-manifests.mjs` (`STEADY_STATE_PUBLISHERS`, `BOOTSTRAP_TARGETS`), `.github/workflows/ci.yml` (`local_scheduler_publish`, `bootstrap_publish_target=local-scheduler`, `validate-local-scheduler` systemd-ci step, gated `publish-local-scheduler`, `ci-capacity-receipts.needs`), and `scripts/ci/ci-expected-results.test.mjs`.

- [ ] **Lot 3 — Verification, PR creation, CI watch, and final cleanup**
  - [ ] Run Docker gates: `make typecheck-local-scheduler ENV=local-scheduler-s2`, `make test-local-scheduler ENV=local-scheduler-s2`, `make build-local-scheduler ENV=local-scheduler-s2`, `make pack-local-scheduler ENV=local-scheduler-s2`, `make test-local-scheduler-systemd-ci ENV=local-scheduler-s2`, `make test-publishable-manifests SCOPE=scripts/ci/publishable-ci-wiring.test.mjs ENV=local-scheduler-s2`, `make test-ci-expected-results ENV=local-scheduler-s2`, `make scope-check ENV=local-scheduler-s2`.
  - [ ] Remove `BRANCH.md` in final commit once local gates pass, re-run Docker gates, push `feat/local-scheduler-s2`, open PR `feat(local-scheduler): Lot S2 systemd user adapter and publish wiring` via `gh pr create` / `gh api`, and watch `gh pr checks <n> --watch` until green.
  - [ ] Write `.tmp/rv/local-scheduler-s2.md` and `.tmp/rv/local-scheduler-s2.done`.
