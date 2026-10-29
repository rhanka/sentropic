# Fix: Correct the production backup reader provider

## Objective
- [x] Revoke the reader created on the wrong provider and document OVH BHS backups.

## Scope / Guardrails
- [x] Documentation only; no production workload or bucket changes.
- [x] No OVH credential creation; tenant operates under the owner's backup rule.
- [x] Local operations: remove only the four reader variables; preserve mode 0600.
- [x] Isolated worktree: `tmp/backup-reader-provider`; branch: `fix/backup-reader-provider`.
- [x] Make-only; English documents; commits at most 150 changed lines, no AI trailers.
- [x] Validation environment: `test-artifact-weight`; no services or ports required.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `BRANCH.md`
  - `docs/runbooks/backup-credentials/CRED_CYCLE.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `docker-compose*.yml`
  - `.cursor/rules/**`
  - `.env`
  - `.track/**`
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `.github/workflows/**`
- **Exception process**:
  - [x] No exceptions required.

## Feedback Loop
- [x] No blocking operational issues; Scaleway revocation and local cleanup verified.

## AI Flaky tests
- [x] Not applicable: documentation only.

## Orchestration Mode (AI-selected)
- [x] Mono-branch; no integration or cherry-pick required.

## UAT Management (in orchestration context)
- [x] Web app, Chrome plugin, VS Code plugin: no changed surfaces or UAT required.

## Plan / Todo (lot-based)
- [x] **Lot 0 — Baseline and revocation**
  - [x] Read packet and repository rules; branch from refreshed `origin/main`.
  - [x] Mechanically verify branch with harness.
  - [x] Verify names, IDs, ownership and creation date before Scaleway deletion.
  - [x] Delete only the API key, policy and application; verify absence.
  - [x] Remove exactly four reader lines; preserve other bytes and mode 0600.
- [x] **Lot 1 — Runbook correction**
  - [x] Document OVH BHS endpoint, region and bucket; dated wrong-provider revocation.
  - [x] Preserve the live pg_dump restore receipt and its S3 verification limit.
  - [x] Require an owner-authorized OVH read-only reader and documented .env rotation.
  - [x] API/UI/E2E tests: no changed or added test files; documentation-only validation.
- [ ] **Lot 2 — Final validation and draft PR**
  - [x] Review runbook facts and diff; run `make scope-check` and whitespace checks.
  - [ ] Create a draft PR with this branch plan as its body; never merge.
  - [ ] Verify CI is green on the reported head and report deleted names/IDs only.
