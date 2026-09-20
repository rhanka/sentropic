# Fix: minio images to quay.io

## Objective
Repoint minio/minio and minio/mc images from the removed Docker Hub namespace to quay.io.

## Scope / Guardrails
- Scope limited to image refs in docker-compose.test.yml and docker-compose.dev.yml.
- Make-only workflow, no direct Docker commands.
- Branch development in isolated worktree `tmp/minio-quay`.
- Automated test campaigns must run on dedicated environments (`ENV=test` / `ENV=e2e`), never on root `dev`.
- In every `make` command, `ENV=<env>` must be passed as the last argument.
- All new text in English.

## Branch Scope Boundaries (MANDATORY)
- **Allowed Paths (implementation scope)**:
  - `docker-compose.test.yml`
  - `docker-compose.dev.yml`
  - `BRANCH.md`
- **Forbidden Paths (must not change in this branch)**:
  - `Makefile`
  - `.cursor/rules/**`
  - `plan/NN-BRANCH_*.md` (except this branch file)
- **Conditional Paths (allowed only with explicit exception when not already listed in Allowed Paths)**:
  - `api/drizzle/*.sql` (max 1 file)
  - `.github/workflows/**`
- **Exception process**:
  - `MINIO-EX1`: `docker-compose*.yml` are default-forbidden but are the explicit target of this fix (4 image refs only, no other changes).
  - Reason: Docker Hub removed the minio namespace; e2e `up-e2e` is blocked on pull.
  - Impact: image registry source only; no config or behavior change.
  - Rollback: revert the 4 refs to `minio/minio:latest` / `minio/mc:latest`.

## Feedback Loop
- None.

## Plan / Todo (lot-based)
- [x] **Lot 1 — Repoint minio images to quay.io**
  - [x] Replace 4 image refs in docker-compose.test.yml and docker-compose.dev.yml
  - [x] Verify quay.io manifests resolve (`minio:latest`, `mc:latest`)
  - [x] Lot gate: scope-check + commit + push + PR
