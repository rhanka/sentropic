# Feature: Resolve exact scanner sources and retained materials (A02)

## Objective
- [ ] Implement admission-plan-r1 section 5 row A02 (R1) under approved amendment r6 section 3.2: resolve/authenticate public sources and exact compiler/base/module/package snapshots, implement ordered patches and retained-material acquisition. Candidate-only; no build eligibility, admission or promotion claim.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`.
- [x] Worktree: `tmp/worktrees/cyber-admission-a02`; branch: `feat/cyber-admission-a02`; base: origin/main `e3fa8fab7f6a9ea802550f2a4e1b269fbb212375` (A01 merged as PR #883).
- [x] Make-only Docker-first; single shared Docker lock `.tmp/packets/DOCKER-LOCK.md` taken per command; reuse the pinned Node image; no new image build.
- [x] `ENV=test-cyber-adm` last; no listening services or ports; no registry login, OIDC, secrets, live promotion or merge.
- [x] Keep production admission, A03+ execution, policy changes and Track writes out of scope; the conductor remains the sole Track writer.
- [x] Tests first; selective staging; `make commit` under 150 changed lines; push after every commit; never suppress CI; never `[skip ci]`.
- [x] Stop on an unresolved design decision; pin selection and implementation follow the approved R1/r6 section 3.2 contract.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `packages/cluster-mesh/src/sessions/registry*.ts`
  - `packages/cluster-mesh/src/index.ts`
  - `packages/cluster-mesh/package.json`
  - `packages/cluster-mesh/tests/remote-session/registry.spec.ts`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package.json`
  - `packages/cluster-mesh/tests/packaging/fixtures/selected/package-lock.json`
  - `api/tests/api/session-remote-view.test.ts`
  - `ui/tests/session-content/navigation.test.ts`
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
- [x] A01 local gate passed 298 tests with zero failures/skips; ready PR #883 CI run 41414318957 passed and merged as `e3fa8fab7`; this branch is rebased on origin/main.
- [x] Prior A02 lane commits (patch/acquisition/offline machinery plus tests) are retained and rebased; the native replay executor and the resolved recipe/material pins are the remaining work.
- [x] Public source investigation confirms Trivy v0.76.1 at commit `e713f67f7d54decdcd9b3132c9751833dcced698` (tag ref, commit API and tree API retained), Go 1.27.3 toolchain, alpine 3.24.2 base at index `sha256:294b683c...`, and the inherited embedded go-jose v4.1.5 defect.
- [x] Preserve upstream authentication gaps and tool-qualification boundaries; a fetched hash or candidate-only fixture grants no admission.
- [x] Retained materials stay outside the repository (`.tmp/daily-cyber/a02-materials`); only the reviewed recipe, material manifest and patch data are committed.

## AI Flaky tests
- [x] Deterministic source/material tests and offline replay; no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch**: single A02 lane with one ready PR against main; no merge.

## UAT Management (in orchestration context)
- [x] No UI surface; executable material and offline dependency checks provide the applicable gate.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read rules, approved r6/plan and the A01 contract; verify both document hashes.
  - [x] Create/confirm isolated worktree `tmp/worktrees/cyber-admission-a02` from origin/main and pass the mechanical harness branch check (PASS C1).
  - [x] Locate the existing pinned Node test lane and the shared Docker lock; preserve production admission off.
- [ ] **Lot 1 — Tests before implementation**
  - [x] Ordered-patch, retained-acquisition and offline-resolution unit tests are collected by `scanner-provenance.test.mjs`.
- [x] Retained proxy paths encode reversibly inside the contract charset (`!x`→uppercase, `/@v/`→`/`, `+`→`-plus-`) with asserted round-trips.
  - [x] Native offline replay test (`native-replay.test.mjs`) requires `SCANNER_MATERIALS` and never skips.
  - [ ] Update `scanner-provenance.test.mjs`: resolved real recipe passes inventory validation, refuses empty retained bytes, and every patch/source/checksum mutation of the real recipe/manifest refuses; wire the native replay test when `SCANNER_MATERIALS` is set.
- [ ] **Lot 2 — Exact source, patch and material implementation**
  - [x] Ordered data-only patches with exact input/output checksums exist under `scripts/security/scanner/patches/`.
  - [x] Resolved and measured the actual pins (upstream archive/authentication/license, Go compiler/go.mod/go.sum/module proxy, base index/manifest/config/layer, APK index/packages, tools, Actions); `recipe.json` and `material-manifest.json` carry no prose pin or pending digest (recipeDigest `sha256:c857dc4b...`, 3138 materials, 10 origins).
  - [ ] Assemble the retained material directory and implement `native-replay.mjs`: offline replay of the patched source resolves go-jose v4.1.6; the OS-only source still exposes v4.1.5 and is rejected.
- [ ] **Lot 3 — Gates, ready PR and report**
  - [ ] Run `make test-security-daily ENV=test-cyber-adm` under the single lock, then the native offline replay with `SCANNER_MATERIALS`, then `make down ENV=test-cyber-adm`.
  - [ ] `make scope-check` before every commit; atomic `make commit` under 150 lines; push after every commit.
  - [ ] Open a ready (non-draft) PR against main once the A02 test gate passes; record its head and CI.
  - [ ] Record exact heads, PR, CI and every test gate in `.tmp/rv/cyber-admission-a02.md` for conductor Track import.
  - [ ] Stop after A02; leave A03+ and all live admission/activation work fenced.
