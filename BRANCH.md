# Feature: qualify the frozen Trivy S2b toolchain

## Objective
- [ ] Produce real S2b qualification receipts and an evidence-backed verdict for every blocker; deliver one draft PR to main.

## Scope / Guardrails
- [x] Base `c37662a20`; branch `feat/sec-s2b-qualify`; worktree `tmp/worktrees/sec-s2b-qualify`.
- [x] Existing activation switch stays OFF; S2c and S3 remain separate prerequisites.
- [x] No scanner removal, severity reduction, toolbox change, secrets or Python.
- [x] Docker under `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`; `ENV=test-sec-qualify` last; `make down` after campaigns.
- [x] No application services or listening host ports; no root dev changes.
- [x] English source/docs; atomic commits below 150 changed lines using `make commit`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `scripts/security/daily/**`
  - `docs/security/**`
  - `.security/trivy-toolchain.json`
  - `Makefile`
- **Forbidden Paths (must not change in this branch)**:
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `api/Dockerfile*`
  - `.github/workflows/**`
  - `plan/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - None.
- **Exception process**:
  - [x] SECQUAL-EX1: Makefile may include a qualification-only adapter; purpose: reproducible Docker-first live trials; impact: opt-in targets only; rollback: remove the include and adapter.

## Feedback Loop
- [x] No previously admitted runtime exists: rollback must restore the explicitly blocked S2a state.
- [ ] Independent scanner/verifier admission requires reviewed evidence, not an author-set boolean.
- [ ] All missing inputs will be named in the final verdict; fixture passes cannot close live gates.

## AI Flaky tests
- [x] No AI inference or timeout increases in this lot.

## Orchestration Mode (AI-selected)
- [x] Single implementation branch; independent peer review at the final evidence gate.

## UAT Management (in orchestration context)
- [x] No UI change; operator UAT consists of live artifact, failure, isolation and rollback trials.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline**
  - [x] Read common/master/workflow rules, owner SEC-Q1..Q5, approved plan and S2b dossier.
  - [x] Fetch origin/main, create isolated worktree, run `harness check branch` (PASS C1).
  - [x] Declare paths, environment, Makefile exception and immutable scanner identities.
- [ ] **Lot 1 — Acquisition and admission evidence**
  - [x] Add a reproducible bounded OCI sizing experiment; keep production ingestion unchanged until measurements complete.
  - [ ] Independently retrieve scanner/verifier bytes, bundles and roots; verify offline.
  - [ ] Inventory image filesystem, native executable dependencies and actual runtime commands without Python.
  - [x] Measure Java: 991026356 compressed / 1565823119 expanded bytes, 86364 KiB Node RSS, 86.4 s transfer; propose bounded per-kind limits.
  - [ ] Verify the Java limit fix with regressions and real ingestion.
  - [ ] Acquire fresh vulnerability/Java receipts and freeze IaC bytes; preserve exact hashes.
- [ ] **Lot 2 — Targets and real trials**
  - [ ] Resolve all three main targets with source-SHA/platform provenance and retain complete reports.
  - [ ] Exercise network/rate-limit, missing/corrupt/stale/incompatible cache, malicious config, expiry and changed snapshot pairs.
  - [ ] Inspect process/mount/credential isolation and exercise rollback to blocked S2a.
  - [ ] Measure cold/warm, refresh, remote/rebuild and CI critical path with queue separate.
- [ ] **Lot 3 — Verification and delivery**
  - [ ] Scoped tests: `scripts/security/daily/toolchain-contract.test.mjs`, `scripts/security/daily/trivy.test.mjs` and qualification regressions.
  - [ ] Final `make test-security-daily` and `make test-security-parser`; cleanup with `make down`.
  - [ ] Reconcile independent peer reviews; record CLOSED / STILL BLOCKED with exact missing inputs under `docs/security/`.
  - [ ] Mechanical scope check before every commit; no publishable package source changes.
  - [ ] Draft PR to main with this plan as body and a 3–6 step plan comment; CI completed/success on exact head.
