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
- [x] Qualification verdict: NOT QUALIFIED; exact missing artifacts/access/analyzer/builder inputs and all receipts in `docs/security/trivy-s2b-qualify.md`.

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
  - [x] Verify retained index bytes with Cosign DSSE attestation, exact issuer/identity and retained roots under `--network=none` (Verified OK).
  - [ ] Inventory image filesystem, native executable dependencies and actual runtime commands without Python.
  - [x] Pull exact platform image, export without execution, inventory APK/filesystem and decode 375 Trivy / 281 Cosign Go dependencies; no Python filesystem matches.
  - [x] Measure Java: 991026356 compressed / 1565823119 expanded bytes, 86364 KiB Node RSS, 86.4 s transfer; propose bounded per-kind limits.
  - [x] Verify the Java limit fix with regressions and real ingestion (161.2 s cold, 5.0 s hash-checked restore).
  - [x] Acquire fresh vulnerability/Java receipts and freeze IaC bytes; preserve exact hashes.
  - [x] Deny current scanner/verifier admission: all-severity self-scans expose HIGH/CRITICAL dependencies; frozen IaC bundle yields zero Compose configs.
- [ ] **Lot 2 — Targets and real trials**
  - [ ] Resolve all three main targets with source-SHA/platform provenance and retain complete reports.
  - [x] Scan all three authenticated main-CI archives cold/warm with immutable archive/config hashes; remote provenance blocked by API/UI config mismatch and absent toolbox tag.
  - [ ] Exercise network/rate-limit, missing/corrupt/stale/incompatible cache, malicious config, expiry and changed snapshot pairs.
  - [x] Twelve recorded trials reject network/TCP faults, damaged/incompatible/expired data, unknown sources and changed snapshots; previous main policy restores blocked S2a.
  - [ ] Inspect process/mount/credential isolation and exercise rollback to blocked S2a.
  - [x] Capture scanner process/mount/environment-name inventories; no network, credentials, daemon socket or writable target/DB mounts.
  - [ ] Measure cold/warm, refresh, remote/rebuild and CI critical path with queue separate.
  - [x] Measure archive cold/warm and DB acquisition/restoration; observe actual remote authorization refusal and absence of isolated builder.
- [ ] **Lot 3 — Verification and delivery**
  - [x] Scoped tests: `scripts/security/daily/toolchain-contract.test.mjs`, `scripts/security/daily/trivy.test.mjs` and qualification regressions.
  - [x] Fix archive report identity using a process-local proof issued only after preparation verifies archive bytes; cloned JSON cannot grant that proof.
  - [x] Final `make test-security-daily` (125 passing) and `make test-security-parser` (17 passing); scoped `make down` completed.
  - [ ] Reconcile independent peer reviews; record CLOSED / STILL BLOCKED with exact missing inputs under `docs/security/`.
  - [ ] Mechanical scope check before every commit; no publishable package source changes.
  - [ ] Draft PR to main with this plan as body and a 3–6 step plan comment; CI completed/success on exact head.
