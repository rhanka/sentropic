# Feature: Resolve exact scanner sources and retained materials (A02)

## Objective
- [ ] Implement admission-plan-r1 section 5 A02 and R1 under approved r6 section 3.2; retain candidate-only status.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`.
- [x] Worktree: `tmp/worktrees/cyber-admission-a02`; branch: `feat/cyber-admission-a02`; base: A01 `87a70d18f213433cf514b0e82ae247fa744770f9`, ready PR #883.
- [x] Make-only Docker-first; single shared Docker lock per command; reuse the pinned Node image; no image build planned.
- [x] `ENV=test-cyber-adm` last; no listening services or ports; no registry login, OIDC, secrets, live promotion or merge.
- [x] Keep production admission, A03+ execution, policy changes and Track writes out of scope; the conductor remains the sole Track writer.
- [x] Tests first; selective staging; make commit under 150 changed lines; push after every commit; never suppress CI.
- [x] Stop on an unresolved design decision; pin selection and implementation follow the approved R1 contract.

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
  - `scripts/ci/publishable-ci-wiring.test.mjs`
  - `.github/workflows/ci.yml`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `packages/mcp-platform/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare BRCADM02-EXn with reason, impact and rollback before a conditional change.

## Feedback Loop
- [x] Retain inherited BRLOCK-EX1 under `.security/ci-lockfile-policy.json`: owner=CI maintainers, review_by=2026-11-30T00:00:00Z; bounded scope and removal trigger remain unchanged, and catalog SCA debt stays open.
- [x] BRCADM02-EX1: add the literal A01 base branch to CI pull_request triggers so the required stacked PR receives ordinary CI; no publication permission change; rollback removes that one base after unstacking.
- [x] A01 local gate passed 298 tests with zero failures/skips and cleanup exit 0; ready PR #883 CI is running.
- [x] Preserve upstream authentication gaps and tool-qualification boundaries; a fetched hash or candidate-only fixture grants no admission.
- [x] Public source investigation confirms Trivy v0.76.1 at e713f67f7d54decdcd9b3132c9751833dcced698 and the inherited embedded go-jose v4.1.5 defect.

## AI Flaky tests
- [x] Deterministic source/material tests and offline replay; no AI flaky exception.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: A02 stacked on A01, separate ready PR, no merge.

## UAT Management (in orchestration context)
- [x] No UI surface; executable material and offline dependency checks provide the applicable gate.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Scope and baseline**
  - [x] Read the approved A02/R1 contract, template, rules and available source evidence; create the stacked worktree and pass the mechanical branch check.
- [ ] **Lot 1 — Tests before implementation**
  - [ ] Add `material-acquisition.test.mjs`, collected by `scanner-provenance.test.mjs`, for source/checksum mutation, ordered patches and bounded retained acquisition.
  - [ ] Add offline dependency replay and OS-only negative controls, with the native replay repeated on the actual resolved sources.
  - [ ] Record the failing pre-implementation gate before adding implementation.
- [ ] **Lot 2 — Exact source, patch and material implementation**
  - [ ] Implement source/archive identity checks, strict ordered patches and retained-file acquisition under `scripts/security/scanner/`.
  - [ ] Resolve exact upstream commit/archive/authentication/license, Go compiler/module checksums, base/package snapshots and tool/Action pins; preserve every actual gap.
  - [ ] Retain resolved bytes and implement dependency resolution from those bytes with network disabled; refuse mutation, undeclared fetches and an OS-only repair.
  - [ ] Replace descriptive recipe/material placeholders with the measured candidate tuple; keep runtime admission off.
- [ ] **Lot 3 — Gates, review and ready PR**
  - [ ] Run the collected suites through `make test-security-daily ENV=test-cyber-adm` under the single lock, then `make down ENV=test-cyber-adm`.
  - [ ] Execute real offline dependency replay plus the source/patch/checksum mutation and OS-only negatives; retain the exact heads, inputs and outcomes.
  - [ ] Obtain two independent code reviews of the actual implementation and pins before build eligibility; reconcile findings.
  - [ ] Validate the stacked CI trigger with its parser test, scope-check every commit and push every atomic commit.
  - [ ] Open a ready PR against A01; record its exact head, CI and every gate in `.tmp/rv/cyber-admission-a01.md`.
  - [ ] Stop after A02; leave A03+ and all live admission/activation work fenced.
