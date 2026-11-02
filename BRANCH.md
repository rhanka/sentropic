# Feature: Reject incomplete scanner candidate contracts (A01)

## Objective
- [ ] Implement admission-plan-r1 section 5 A01 under approved amendment r6 section 3; no live admission or promotion.

## Scope / Guardrails
- [x] Binding r6 SHA-256: `4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f`.
- [x] Binding plan SHA-256: `528dd39308a6e2cf8bdf31307c82da373cf3ceb666cb865a0417abfa7ece49d2`.
- [x] Worktree: `tmp/worktrees/cyber-admission-a01`; branch: `feat/cyber-admission-a01`; base: `78c746f538f1381dfc7bf06834dc7ea9d654d5a9`.
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
- [x] Rebased from the initial `e1c0ef97d` base to resolve the sole BRANCH.md conflict; the code patch and scanner material context remain byte-identical, retaining both passing code reviews under r6 section 1.3.
- [x] Mistral F1: constrain executed no-op test blocks to literal echo statements; reject commands, expressions, redirection and substitutions before execution.
- [x] Mistral F2: restore parsed checkout-ref assertions for all three jobs; F4: add workflow/control mutation negatives.
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
  - [x] Validate exact source/tool/base/module/package/patch pins and retained material bytes under `scripts/security/scanner/`.
  - [ ] Reject current pending recipe and material pins; accept a complete synthetic contract only.
- [ ] **Lot 2 — Receipt and artifact contracts**
  - [x] Define a synthetic three-receipt tuple with measured fixture outputs; it supplies no platform authority.
  - [x] Replace weak text assertions in `scripts/security/daily/scanner-image-publish.test.mjs`.
  - [x] Write rehashed receipt substitution, missing/empty output and strict-field negative controls before implementation.
  - [x] Define strict schemaVersion 1 build, validation and publication receipt fields from r6 sections 1.3 and 3.3.1.
  - [x] Enforce strict receipt schemas, matching identities, nonempty measured artifact outputs and ordered material binding.
  - [x] Add isolated execution of the actual key-free echo steps and assert no receipt files are produced.
  - [x] Add rehashed malformed-OCI and impossible-calendar-date negative controls.
  - [x] Fail closed on malformed OCI structures and normalized impossible dates.
- [ ] **Lot 3 — Final validation and handoff**
  - [ ] Run `make test-security-daily ENV=test-cyber-adm` under the single lock.
  - [ ] Run `make down ENV=test-cyber-adm`; verify scope before each commit.
  - [ ] Open a ready PR against main after the local gate; use this file as the PR body.
  - [ ] Record exact head, PR, CI and gate evidence in `.tmp/rv/cyber-admission-a01.md` for conductor Track import.
  - [ ] Continue only A02 on its stacked branch; retain A03+ and runtime admission gates.
