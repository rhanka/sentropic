# Feature: ACT-L04 — native ast-grep SAST, full Trivy IaC adaptation and independent expected inventories (daily cyber activation, amendment r6)

## Objective
Implement lot ACT-L04 of r6 §7.2 (W2): qualify native Rust ast-grep with frozen local rules under `.security/ast-grep/**`, complete the Trivy IaC multi-document adaptation with expected document identities, and extend `inventory.mjs` with independent expected inventories and completeness proofs — observable acceptance L4-A–E (r4 Lot 4). No other lot is started.

## Scope / Guardrails
- Scope limited to `.security/ast-grep/**`, the new `scripts/security/daily/{sast,iac}.mjs` + `sast-contract.test.mjs` + `iac-contract.test.mjs` + fixtures, the evolved `scripts/security/daily/{inventory,scan,trivy,acceptance-disposition}.mjs` and their tests, `api/Dockerfile` (SECDAILY-EX6 pin reference only), `Makefile` (BR04-EX1 SCOPE only) and `BRANCH.md`.
- Binding design: `.tmp/daily-cyber/activation-amendment-r6.md` (sha256 4438d481e5021b06299d7c61bc95354dcd45d42664e59fdbecf02a2b0cfd451f) and r4 (sha256 a4cc7449ad3b204dd8cef5bf57015c4b7ddaeaf29e031d3811dded6b6ef7d80d). No design decision outside r6/r4; anything else is reported, not decided.
- Make-only workflow, Docker under the flock `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`, `ENV=test-cyber-L04` always LAST, `make down ENV=test-cyber-L04` after. Never `ENV=dev`, never `make clean-all`.
- Zero Python anywhere (Node/TS and native binaries only). Zero payment on quota exhaustion. No secrets read, printed, logged or committed.
- ast-grep pin: official GitHub release 0.51.0 asset `app-x86_64-unknown-linux-gnu.zip`, sha256 a7eead5552d3a8daad70f5d50d935da44bd0c138e946b5b0a96b1d38169fa639, native glibc ELF binaries `sg`/`ast-grep`; no musl asset exists, so execution runs on the glibc pinned Node lane while the alpine toolbox carries the pinned bytes for Trivy embedded-binary inventory. No runtime rule downloads; rules are frozen local files only.
- SAST execution stays fenced on L02 scanner admission; this lot delivers the qualified contract, rules, fixtures and completeness proofs, not live scanner execution.
- Branch development happens in worktree `tmp/worktrees/cyber-act-L04` on branch `feat/cyber-act-L04`.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `.security/ast-grep/**`
  - `scripts/security/daily/sast.mjs`
  - `scripts/security/daily/sast-contract.test.mjs`
  - `scripts/security/daily/iac.mjs`
  - `scripts/security/daily/iac-contract.test.mjs`
  - `scripts/security/daily/fixtures/**`
  - `scripts/security/daily/inventory.mjs`
  - `scripts/security/daily/inventory.test.mjs`
  - `scripts/security/daily/scan.mjs`
  - `scripts/security/daily/scan.test.mjs`
  - `scripts/security/daily/trivy.mjs`
  - `scripts/security/daily/trivy.test.mjs`
  - `scripts/security/daily/acceptance-disposition.mjs`
  - `api/Dockerfile` (BR04-EX2 granted subtree under the forbidden `api/**`; see Conditional Paths and Feedback Loop)
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.github/workflows/**`
  - `.tmp/**`
  - `.track/**`
  - `api/**`
  - `packages/**`
  - `apps/**`
  - `ui/**`
  - `tools/**`
  - `docs/**`
  - `scripts/ci/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `Makefile` (BR04-EX1: only the `test-security-daily` SCOPE list gains `scripts/security/daily/sast-contract.test.mjs` and `scripts/security/daily/iac-contract.test.mjs` so the L4-A/L4-B/L4-C cases run in the required suite that CI already executes)
  - `api/Dockerfile` (BR04-EX2: SECDAILY-EX6 permits only local rules and pin references in the exact approved toolbox path — add the pinned ast-grep release fetch with sha256 verification to `ci-tool-base` and COPY the pinned binary into `ci-tools`; the frozen rules stay in the repo checkout, not in the image; no other Docker instruction changes)
- **Exception process**:
  - BR04-EX1 declared here before touching `Makefile`: reason = r6 §7.3/§6.4 require every destination wired into its owning required Make suite (`test-security-daily`, already run by required CI job `validate-ci-capacity-metrics`); impact = two additive SCOPE entries only, no existing entry removed; rollback = revert the single SCOPE line.
  - BR04-EX2 declared here before touching `api/Dockerfile`: reason = r6/r4 Lot 4 and SECDAILY-EX6 require the native ast-grep pin reference in the approved toolbox image so its reviewed digest binds the binary; impact = one verified pin fetch RUN in `ci-tool-base` plus one COPY line in `ci-tools`, no other instruction; rollback = revert those lines.

## Feedback Loop
- BR04-EX1: `acknowledge` — Makefile SCOPE addition for `test-security-daily` (see Conditional Paths).
- BR04-EX2: `acknowledge` — `api/Dockerfile` SECDAILY-EX6 pin reference for ast-grep (see Conditional Paths).
- `BRLOCK-EX1` acknowledgement: review_by=2026-11-30T00:00:00Z (CI lockfile lane policy, owner CI maintainers).
- No open blockers: r6/r4 supply every design decision for this lot; anything not covered is reported in the final report, not decided here.

## AI Flaky tests
- Acceptance rule:
  - Accept only non-systematic provider/network/model nondeterminism as `flaky accepted`.
  - Non-systematic means at least one success on the same commit and same command.
  - Never amend tests with additive timeouts.
  - If flaky, analyze impact vs `main`: if unrelated, accept and record command + failing test file + signature in `BRANCH.md`; if related, treat as blocking.
  - Capture explicit user sign-off before merge.
- This lot runs only synthetic, network-free suites; no AI flaky lane applies.

## Orchestration Mode (AI-selected)
- [x] **Mono-branch + cherry-pick** (single branch `feat/cyber-act-L04`; one final CI on the review-ready head)
- Rationale: single self-contained lot with one test suite; no sub-workstreams needing independent CI.

## UAT Management (in orchestration context)
- **Mono-branch**: no UI/API behavior change; no UAT applies. Local validation is `make test-security-daily ENV=test-cyber-L04` under the Docker flock.

## Plan / Todo (lot-based)
- [ ] **Lot 0 — Baseline & constraints**
  - [x] Read r6/r4 binding documents and COMMON-RULES packet (CI budget, machine load, crash safety, secrets).
  - [x] Create/confirm isolated worktree `tmp/worktrees/cyber-act-L04` on `feat/cyber-act-L04` from `origin/main` and run `harness check branch`.
  - [x] Capture Makefile targets needed: `test-security-daily`, `security-daily-scan`, `down`, `commit`, `scope-check`.
  - [x] Confirm command style: `make ... <vars> ENV=test-cyber-L04` with `ENV` last; Docker under the packet flock.
  - [x] Confirm scope boundaries and declare BR04-EX1/BR04-EX2 above.
  - [x] Validate ast-grep 0.51.0 pin (sha256 a7eead55...69fa639) and rule syntax against fixtures with the pinned native binary.
- [x] **Lot 1 — Frozen ast-grep rules and manifest (L4-A/L4-B inputs)**
  - [x] `.security/ast-grep/sgconfig.yml` (local ruleDirs only, languageGlobs covering all inventoried source extensions).
  - [x] `.security/ast-grep/rules/*.yml` (11 baseline rules, each with positive/negative fixtures).
  - [x] `.security/ast-grep/rules-manifest.json` (per-rule sha256, severity mapping, toolbox pin, zero-Python statement, validation receipt).
  - [x] `scripts/security/daily/fixtures/sast/**` positive/negative fixtures.
- [x] **Lot 2 — SAST contract module and tests (L4-A/L4-B)**
  - [x] `scripts/security/daily/sast.mjs` (loadSastContract, planSastTasks, validateSastReport, runner contract).
  - [x] `scripts/security/daily/sast-contract.test.mjs` (rule/root coverage, hashes, runtime-download block, zero-Python toolbox proof).
  - [x] Wire SAST tasks into `scan.mjs` / `inventory.mjs` (contract qualified, execution still fenced on L02).
- [x] **Lot 3 — IaC adaptation and tests (L4-C)**
  - [x] `scripts/security/daily/iac.mjs` (expected document identities, planIacScan, validateIacReport).
  - [x] `scripts/security/daily/fixtures/iac/**` (multi-doc compose, k8s, Makefile with positive controls).
  - [x] `scripts/security/daily/iac-contract.test.mjs` (positive control per surface, drop-one-doc, zero-config, malformed).
  - [x] Rewire `trivy.mjs` `requireIacQualification` to the qualified contract.
- [x] **Lot 4 — Independent expected inventories and completeness (L4-D/L4-E)**
  - [x] Extend `inventory.mjs` (expected lock components, embedded binaries, tool catalog, consumers; validateCompleteness; exact blockers).
  - [x] Evolve `inventory.test.mjs` (two agreeing outputs both omitting an item still fail; N/A needs positive proof).
- [x] **Lot 5 — Wiring and toolbox pin**
  - [x] `acceptance-disposition.mjs` L4-A..E rows (owner ACT-L04, suite test-security-daily).
  - [x] `Makefile` SCOPE += 2 test files (BR04-EX1); evolve `scan.test.mjs`/`trivy.test.mjs` assertions.
  - [x] `api/Dockerfile` ast-grep pin (BR04-EX2).
  - [ ] `make scope-check` + `harness check scope` clean.
- [ ] **Lot 6 — Validation, commits, PR, CI, report**
  - [ ] `flock .tmp/packets/DOCKER-LOCK.md make test-security-daily ENV=test-cyber-L04`, then `make down ENV=test-cyber-L04`.
  - [ ] Atomic commits via `make commit MSG=` (≤150 lines each), push branch after each lot (crash safety).
  - [ ] Draft PR with BRANCH.md body; ONE CI run on the final head; wait for completion.
  - [ ] Report to `.tmp/rv/cyber-act-L04.md` (PR, head, CI result, each acceptance item L4-A–E); stop; do not merge.
