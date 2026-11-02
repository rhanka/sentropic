# Feature: Isolated two-build scanner executor (A03)

## Objective
- [ ] Implement admission-plan-r1 section 5 row A03 (R2 commands) under approved amendment r6 section 3.2 stage 4: actual build/layout/SBOM/reproducibility commands in `scripts/security/scanner/`, executed against the reviewed qualification sandbox with bounded retained acquisition. Candidate-only; no workflow change, live build, admission or promotion claim.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`.
- [x] Worktree: `tmp/worktrees/cyber-admission-a03`; branch: `feat/cyber-admission-a03`; base: origin/main `d1f45c625` (A02 merged as PR #884, A01 as PR #883).
- [x] Make-only Docker-first; single shared Docker lock `.tmp/packets/DOCKER-LOCK.md` taken per command (`flock <lock> make ...`); reuse the pinned Node image `node:24-bookworm-slim@sha256:0e0ff40c...`; no new image build.
- [x] `ENV=test-cyber-adm` last; no listening services or ports; no registry login, OIDC, secrets, live promotion or merge; `make down ENV=test-cyber-adm` after.
- [x] Keep the promotion workflow (A08), verifier (A05), trust state (A06), production admission, policy changes and Track writes out of scope; the conductor remains the sole Track writer.
- [x] Tests first; selective staging; `make commit` under 150 changed lines; push after every commit; never suppress CI; never `[skip ci]`.
- [x] Stop on an unresolved design decision; the two-build normalized comparison (filesystem/binary/dependencies, empty allowedDifferences) and the isolation probes are fixed by r6 section 3.2 and receipt-schema.mjs.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/scanner/**`
  - `scripts/security/daily/scanner-provenance.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.security/**`
  - `.track/**`
  - `packages/**`
  - `.github/workflows/**`
  - `scripts/ci/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - none
- **Exception process**:
  - [x] No exception declared; no conditional or forbidden path is touched.

## Feedback Loop
- [x] Retain inherited BRLOCK-EX1 under `.security/ci-lockfile-policy.json`: owner=CI maintainers, review_by=2026-11-30T00:00:00Z; bounded scope and removal trigger remain unchanged, and catalog SCA debt stays open.
- [x] A01 merged as PR #883 (`e3fa8fab7`), A02 merged as PR #884 (`d1f45c625`); this branch is cut from origin/main `d1f45c625`.
- [x] A02 retained materials stay outside the repository at `.tmp/daily-cyber/a02-materials/retained` (3138 files, 1,071,738,643 bytes); the native two-build fixture gate mounts them read-only with `SCANNER_MATERIALS` under `--network=none`. Retained bytes grant no admission.
- [x] Real scanner outputs remain candidate data: the executor returns `productionAdmitted: false` and never writes a receipt, policy pin or admission flag.

## AI Flaky tests
- [x] Deterministic fixture builds and contract tests; no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: single A03 lane with one ready PR against main; no merge.

## UAT Management (in orchestration context)
- [x] No UI surface; the executable fixture two-build gate and the isolation probes provide the applicable gate.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read rules, approved r6/plan and the A01/A02 contracts; verify both document hashes.
  - [x] Create isolated worktree `tmp/worktrees/cyber-admission-a03` from origin/main and pass the mechanical harness branch check (PASS C1).
  - [x] Locate the existing pinned Node test lane (`make test-security-daily`) and the shared Docker lock; preserve production admission off.
- [ ] **Lot 1 — Tests before implementation**
  - [x] `build-executor.test.mjs` (collected by `scanner-provenance.test.mjs`): build refusal without verified materials, CLI probe report.
  - [x] `build-isolation.test.mjs`: sanitized env inherits no process env; refuses credential/OIDC/docker keys, shared daemon sockets (real unix socket and plain file) and any python on the build PATH.
  - [x] `build-layout.test.mjs`: deterministic filesystem normalization across roots (symlink/mode/content refusals), APK/Go-module parsing, stable dependency inventory, deterministic OCI layout with index→manifest→config→layer linkage, two-build compare with forced mismatch refusal.
  - [x] `native-build.test.mjs` (collected only with `SCANNER_MATERIALS`, never skips): compiles the small Go executable fixture twice with the pinned retained compiler under `--network=none`, compares binary/filesystem/dependencies, forces a mismatch, probes isolation, stages the real patched source.
  - [x] Tests pushed RED first (`9d1f69cf0`, `3114494bf`, `dcb8775a2`), then GREEN after implementation.
- [x] **Lot 2 — Executor implementation**
  - [x] `build-isolation.mjs`: `buildEnvironment` (constructed from scratch, no process.env inheritance) and `probeIsolation` (credentials/OIDC/shared-socket/Python refusal).
  - [x] `build-layout.mjs`: `normalizeOutputTree`, `parseApkPackage`, `parseGoModuleList`, `dependenciesInventory`, deterministic `makeOciLayout`, `compareBuilds` (empty allowedDifferences only).
  - [x] `build-executor.mjs`: `stagePatchedSource` (verified retained materials → pinned source → digest-bound patches), `buildOnce` (pinned offline Go build, isolation probe, OCI layout, normalized SBOM), `runTwoBuilds` (sequential isolated reproductions + reproducibility gate). Candidate data only (`productionAdmitted: false`).
  - [x] `build-cli.mjs`: fixed `probe` / `build-once` / `build-twice` command surface for the later A08 workflow wiring.
- [ ] **Lot 3 — Gates, ready PR and report**
  - [x] `flock .tmp/packets/DOCKER-LOCK.md make test-security-daily ENV=test-cyber-adm` at head `ecb6e1f60`: **321 passed, 0 fail, 0 skip** (37 suites); log `.tmp/rv/cyber-admission-a03-test-security-daily.log`.
  - [x] Native two-build fixture gate under the same lock, `--network=none`, `SCANNER_MATERIALS` mounted read-only at head `ecb6e1f60`: **3 passed, 0 fail** (two-build reproducible 25.9s, forced mismatch refused 35.5s, real patched source staged 2.4s); log `.tmp/rv/cyber-admission-a03-native-build.log`.
  - [x] `flock ... make down ENV=test-cyber-adm` after the gates; no new image built (reused pinned `node:24-bookworm-slim@sha256:0e0ff40c...`); scratch work dir removed.
  - [x] `make scope-check` PASS C2 and `harness check branch` PASS C1; atomic `make commit` under 150 lines each; pushed after every commit; no `[skip ci]`.
  - [ ] Open ready (non-draft) PR against main; pull_request CI fires on the final head.
  - [ ] Record exact heads, PR, CI and every test gate in `.tmp/rv/cyber-admission-a03.md` for conductor Track import.
  - [ ] Stop after A03; leave A04+ and all live admission/activation work fenced.
