# Chore: backup reader credential cycle

## Objective
- [ ] Enable read-only production backup recovery for the sentropic tenant.

## Scope / Guardrails
- [x] Worktree `tmp/backup-reader-cred`, branch `chore/backup-reader-cred`, base `origin/main`.
- [x] Make-only; `ENV=test-backup-reader` last; no services or cluster resources.
- [x] Secret material belongs only in the ignored root `.env` with mode `0600`.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/runbooks/backup-credentials/CRED_CYCLE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.env`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No tracked scope exception; operational commands use an ephemeral Makefile.

## Feedback Loop
- [ ] BR-CRED-01 | blocked | operator | 2026-10-29: reader LIST returns 403; configured operator GET bucket policy returns 403. Bucket restriction requires Object Storage policy administration; preserve the restrictive IAM condition pending resolution.

## AI Flaky tests
- [x] None; documentation-only diff.

## Orchestration Mode (AI-selected)
- [x] Single author; no parallel implementation.

## UAT Management (in orchestration context)
- [x] No UI change; acceptance is real S3 authorization and recovery verification.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and authorization**
  - [x] Read owner approval, repository rules, immo credential cycle, W0-close.c packet.
  - [x] Create isolated branch from fetched `origin/main`; mechanical branch check passes.
- [ ] **Lot 1 — Provision and verify**
  - [x] Create dedicated application, conditional read-only IAM policy, expiring API key.
  - [x] Store four requested variable names directly in ignored root `.env`; no values displayed.
  - [x] Real PUT probe returns HTTP 403 AccessDenied; no object created.
  - [ ] Successful LIST, versions, HEAD, and versioned GET; effective bucket restriction proven.
- [x] **Lot 2 — Docs consolidation**
  - [x] Record names, storage, expiry, rotation, revocation, checks, and current blocker.
- [ ] **Lot 3 — Final validation**
  - [x] Mechanical scope check passes; plan and runbook split into commits below 150 lines.
  - [ ] Draft PR using this plan as body; CI success on its exact head.
  - [ ] Resume local W0-close.c only after the reader passes positive access checks.
