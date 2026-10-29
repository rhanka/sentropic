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
  - [x] Operational commands use an ephemeral Makefile; inherited main changes only under BR-CRED-EX1.
  - [x] BR-CRED-EX1: owner authorizes merging origin/main if needed, without rebase. GitHub reported a conflict; merge `e938151c0942679d37f88c7ffb4a2c3df048627a`, preserving this plan. Inherited main bytes only are exempt from scope and the 150-line authored-change limit; validate scope relative to origin/main. Impact: upstream history retained, no authored product change; rollback requires a separately authorized merge revert. Both parents have identical Track trees; Track acceptance refresh belongs to its designated writer.

## Feedback Loop
- [ ] BR-CRED-01 | blocked | operator | 2026-10-29: reader LIST refused (403); operator GetBucketPolicy also returns 403. Bucket policy is the likely cause but was not read; cause unverified, reader unusable pending resolution. Preserve the restrictive IAM condition.

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
  - [x] Address Opus r1 C1/C2: link the completed owner-selected live-dump restore receipt in #702, distinguish S3 recovery, record the unverified LIST cause and withdrawn Kubernetes request.
- [ ] **Lot 3 — Final validation**
  - [x] Mechanical scope check passes; plan and runbook split into commits below 150 lines.
  - [ ] Draft PR using this plan as body; CI success on its exact head.
  - [x] W0-close.c completed on 2026-10-29 from a live production dump per owner decision; reader absent from that restore path, Kubernetes request withdrawn.
