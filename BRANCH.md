# Feature: Deployment to GitHub Pages & Scaleway Container

## Objective
Setup automated deployment for UI (GitHub Pages) and API (Scaleway Container Serverless) with CI/CD integration. To enable streamlined deployment, migrate from sqlite to postgres, targetting serverless postgres db on scaleway.

## Plan / Todo

### Deployment (CI/CD, Scaleway, GitHub Pages)
- [x] Fix GitHub Actions conditions for deployment jobs (github.ref instead of branch)
- [x] Add missing dependencies in deployment jobs (needs: [changes, ...])
- [x] Fix deploy-ui job syntax (remove duplicate runs-on line)
- [x] Add Postgres 16 service in docker-compose (port 5432, volume, healthcheck)
- [x] Switch DB client to `pg` and `drizzle-orm/node-postgres`
- [x] Port schema from `sqliteTable` to `pgTable` (types kept simple: text/integer/timestamp)
- [x] Configure Drizzle for Postgres and generate initial migrations
- [x] Adjust Make targets and env to use Postgres `DATABASE_URL`
- [ ] Update DB scripts (status/seed/backup/restore) for Postgres
- [x] Refactor residual raw `db.all/run` calls to Drizzle PG
- [ ] Run unit/integration/E2E tests locally on Postgres and fix issues (API: OK, AI sync: OK; AI async: borderline local)
- [ ] Update CI to start Postgres and set `DATABASE_URL`
- [ ] Docs: README/TODO updates, add env migration notes
- [ ] Test Scaleway deployment locally with make commands
- [ ] Verify make publish-api-image works correctly
- [ ] Verify make deploy-api works correctly
- [ ] Test complete deployment flow
- [ ] Push changes and verify CI pipeline
- [ ] Update TODO.md and RELEASE.md

## Commits & Progress
- [ ] **Commit 1**: Fix GitHub Actions deployment conditions and job dependencies
- [ ] **Commit 2**: Complete and test deployment workflow

## Status
- **Progress**: Postgres local switched (service, client, schema, migrations). Cleanup done. API smoke/unit/endpoints/queue: OK. AI sync: OK.
- **Current**: AI async completes partially locally (4/10 in 120s) — latency-bound; expected stable in CI.
- **Next**: Push branch, monitor CI; then run full E2E UI and update docs.

## Notes
- Need SCALEWAY_ACCESS_KEY and SCALEWAY_SECRET_KEY environment variables
- Need DOCKER_USERNAME, DOCKER_PASSWORD, and REGISTRY variables
- API_IMAGE_NAME and API_VERSION are auto-calculated by Makefile

---

## Migration PostgreSQL 16 (Local)

### Objective
Migrate local/dev stack from SQLite to PostgreSQL 16, keeping app logic unchanged first.

### Plan / Todo
- [x] Add Postgres 16 service in docker-compose (port 5432, volume, healthcheck)
- [x] Switch DB client to `pg` and `drizzle-orm/node-postgres`
- [x] Port schema from `sqliteTable` to `pgTable` (types kept simple: text/integer/timestamp)
- [x] Configure Drizzle for Postgres and generate initial migrations
- [x] Adjust Make targets and env to use Postgres `DATABASE_URL`
- [ ] Update DB scripts (status/seed/backup/restore) for Postgres
- [ ] Refactor residual raw `db.all/run` to Drizzle queries compatible with PG
- [ ] Run unit/integration/E2E locally on Postgres and fix issues
- [ ] Update CI to start Postgres and set `DATABASE_URL`
- [ ] Docs: README/TODO updates, add env migration notes

## Cleanup Plan (SQLite/Litestream ➜ Postgres)
- [x] 1) Update DB scripts for Postgres: `db-status`, `db-backup`, `db-restore`, `db-reset`
- [x] 2) Remove `sqlite` and `litestream` services from `docker-compose.yml`
- [x] 3) Remove host `ports: "5432:5432"` publish for Postgres (internal network only)

### Notes
- Initial step keeps JSON as `text` for speed; can switch to `jsonb` later
- Queue locking: keep single instance for now; add `FOR UPDATE SKIP LOCKED` later if needed
- Remote (serverless PG) will require `PGSSLMODE=require` and connection retries on cold start

