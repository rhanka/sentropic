# Feature: Reject incomplete scanner candidate contracts (A01)

## Objective
- [ ] Implement admission-plan-r1 section 5 A01 under approved amendment r6 section 3; no live admission or promotion.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`.
- [x] Worktree: `tmp/worktrees/cyber-admission-a01`; branch: `feat/cyber-admission-a01`; base: `e1c0ef97d1806065b8e238da9302716fc789da3a`.
- [x] Make-only Docker-first; shared `.tmp/packets/DOCKER-LOCK.md` flock; reuse pinned Node image; no image build.
- [x] `ENV=test-cyber-adm` last; no services or listening ports needed; no credentials, registry login or OIDC.
- [x] No policy admission changes, A03+ work, new dependencies, Track writes or merge.
- [x] Tests first; selective staging; make commit under 150 lines; push every commit; never suppress CI.
- [x] Stop on an undecided design question; implementation follows the approved contract.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/scanner/**`
  - `scripts/security/daily/scanner-provenance.test.mjs`
  - `scripts/security/daily/scanner-image-publish.test.mjs`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.security/**`
  - `.track/**`
  - `packages/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] Declare BRADM-EXn with reason, impact and rollback before a conditional change.

## Feedback Loop
- [x] Design authority and Track writer remain the conductor; this branch supplies source artifacts and test evidence.
- [x] Current workflow and recipe are incomplete; A01 must demonstrate refusal without implementing later workflow stages.

## AI Flaky tests
- [x] Deterministic Node tests only; no AI acceptance exception.

## Orchestration Mode (AI-selected)
- [x] **Multi-branch**: A01 then A02 stacked on A01, with separate ready PRs; no merge.

## UAT Management (in orchestration context)
- [x] No UI surface; automated contract checks provide the applicable gate.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline & constraints**
  - [x] Read rules, approved plan and r6 scanner contract; verify both document hashes.
  - [x] Create isolated worktree from origin/main and pass mechanical harness branch check.
  - [x] Locate existing pinned Node test lane and shared Docker lock; preserve production admission off.
- [ ] **Lot 1 — Strict material contracts**
  - [x] Write negative controls first in `scripts/security/daily/scanner-provenance.test.mjs`.
  - [ ] Validate exact source/tool/base/module/package/patch pins and retained material bytes under `scripts/security/scanner/`.
  - [ ] Reject current pending recipe and material pins; accept a complete synthetic contract only.
- [ ] **Lot 2 — Receipt and artifact contracts**
  - [ ] Replace weak text assertions in `scripts/security/daily/scanner-image-publish.test.mjs`.
  - [ ] Enforce strict receipt schemas, matching identities, nonempty measured artifact outputs and ordered material binding.
  - [ ] Demonstrate that receipt-name echoes and missing outputs cannot establish eligibility.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Run `make test-security-daily ENV=test-cyber-adm` under the single lock.
  - [ ] Run `make down ENV=test-cyber-adm`; verify scope before each commit.
  - [ ] Open a ready PR against main after the local gate; use this file as the PR body.
  - [ ] Record exact head, PR, CI and gate evidence in `.tmp/rv/cyber-admission-a01.md` for conductor Track import.
  - [ ] Continue only A02 on its stacked branch; retain A03+ and runtime admission gates.
