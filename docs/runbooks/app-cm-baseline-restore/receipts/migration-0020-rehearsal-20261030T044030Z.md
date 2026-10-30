# Migration 0020 rehearsal — 30 October 2026

**PASS:** the real API migration entry succeeds against a freshly restored
production baseline, then succeeds again without changing any table count,
sorted COPY-row hash, migration journal or normalized schema hash.
Execution head: `95a92bc3d39e4490934db6ec85b4789b76709798` (PR #837).
Operator: Codex. Only aggregate counts, hashes and operational metadata retained.

## Baseline provenance and isolation

The owner explicitly authorized a fresh baseline using the W0-close procedure
because the original W0 dump was deleted. This receipt closes the migration
rehearsal under that instruction; it does not claim recovery of identical W0
archive bytes. Historical review statements requiring those bytes are superseded
for this rehearsal by that instruction.

- Source: fresh live production `pg_dump`, namespace `sentropic`, through the
  existing `make db-backup-prod` target; no production migration executed.
- File: `prod-2026-10-30T00-40-30.dump`; **1,807,558 bytes**. SHA-256 before
  restore and immediately before deletion:
  `cf38d3408d0fbaefe9f996bea80f44230104681106638a634b875c5403816cd9`.
- Read only `K8S_TENANT_ADMIN_KUBECONFIG_B64` by name from the root `.env`,
  decoded into a mode **0600** scratch file under `/tmp`, outside the repo.
  The file and its mode 0700 directory were deleted immediately after backup.
- Docker flock held for build, restore, migrations, inspection and teardown:
  `/home/antoinefa/src/sentropic/.tmp/packets/DOCKER-LOCK.md`.
- Compose project `test-app-837-m0020`, volume `test-app-837-m0020_pg_data`,
  local database `app`, PostgreSQL **17.11**, no PostgreSQL host port.
  API/UI/Maildev ports **8803/5203/1103** were verified free; no app server started.
- Temporary make overlay fixed Compose to `--env-file /dev/null -p $(ENV)`
  with a sanitized environment. The worktree had no `.env`. Local containers
  received no production credentials. The API CLI used `NODE_ENV=test`, a local
  database URL, a dummy TEM configuration value and all three artifact flags `0`.
- API toolbox built from this head by `make build-api-tool-image`:
  `sha256:292ace91b8b2754842895dd29b0044d7a06be08f8b434b5c22a26fb4094fe7d5`.
  The build used task-scoped `BUILDX_CONFIG` under `/tmp`.

## Execution

All commands used `make -f Makefile -f <temporary-isolating-overlay>`, with
`API_PORT=8803 UI_PORT=5203 MAILDEV_UI_PORT=1103 ENV=test-app-837-m0020`
appended, **ENV last**. The overlay's `COMPOSE_RUN_API` ran the exact-source
toolbox once with `--rm --network test-app-837-m0020_default`, working directory
`/workspace/api`, the local-only environment above and no host port or mount.

```bash
make db-backup-prod KUBECONFIG=<0600-scratch-path> K8S_NAMESPACE=sentropic ... ENV=test-app-837-m0020
make db-restore BACKUP_FILE=prod-2026-10-30T00-40-30.dump SKIP_CONFIRM=true ... ENV=test-app-837-m0020
make db-migrate ... ENV=test-app-837-m0020
make db-migrate ... ENV=test-app-837-m0020
make down ... ENV=test-app-837-m0020
make clean ... ENV=test-app-837-m0020
```

`db-migrate` invokes `npm run db:migrate` inside that container, hence
`tsx src/scripts/db-migrate.ts` → `runMigrations()`: product stream, settings
reconciliation, control stream and verified package assets, under the API's
advisory migration lock. No SQL-only substitute or migration-journal rewind.

| Step | UTC start | UTC end | Exit |
| --- | --- | --- | ---: |
| Restore | 04:40:34 | 04:40:41 | 0 |
| API first migration run | 04:40:44 | 04:40:45 | 0 |
| API second migration run | 04:40:47 | 04:40:48 | 0 |
| Cleanup complete | | 04:40:51 | 0 |

An earlier isolated attempt failed environment validation before migration
execution because TEM configuration was missing. Its dump and project were
deleted. The successful sequence above used a new dump and the dummy value.

## Counts and checksums

Read-only inspection used `psql -X -w -qAt -v ON_ERROR_STOP=1`, with
`default_transaction_read_only=on` and a 20-second statement timeout. Every
baseline table count and sorted COPY-row SHA-256 matched the archive: **91/91**.
The normalized archive/restored schema hashes also matched. Normalization
removes comments, blank lines and random `\restrict`/`\unrestrict` guards;
COPY hashing sorts rows with `LC_ALL=C`, without printing or retaining row data.

| Metric | Restored baseline | First run | Second run |
| --- | ---: | ---: | ---: |
| Base tables | 91 | 114 | 114 |
| Product journal rows / max ID | 44 / 44 | 45 / 45 | 45 / 45 |
| Control journal rows / max ID | 11 / 11 | 17 / 17 | 17 / 17 |
| Exact 0020 hash receipts | 0 | 1 | 1 |
| Artifact package asset receipts | 0 | 4 | 4 |
| Duplicate asset receipts | 0 | 0 | 0 |
| `control.artifact_host_kv` exists / rows | absent | 1 / 0 | 1 / 0 |
| Nullable unique `asset_id` column | absent | present | present |
| Invalid indexes / unvalidated constraints | 0 / 3 | 0 / 4 | 0 / 4 |

0020 SHA-256: `510c8b931b6d57048d4f6400ab61de04b7bd116a56aa2b59f87af3e9d1570c98`.
Product timestamp frontier: `1792201313001` → `1793250000000` (`0048_canvas_live_h2`).
Control timestamp frontier: `1791860000000` → `1793145600000` (`0012_decision_host`).
The runner applies both pending control migrations (0020 then 0012) plus four
package assets. 0012 adds two pricing rows and one NOT VALID CHECK declaration;
0048 creates three empty canvas tables. All **23** new tables are empty.
Of the **91** original tables, **88** retain identical counts and COPY hashes;
the only changes are the two journals and `control.model_pricing` (0 → 2 rows).

Selected baseline counts, unchanged after both runs: tenants/memberships **1/7**,
workspaces/memberships **16/14**, users/sessions **8/149**, OAuth clients/consents/
tokens **7/12/470**, revoked tokens/service clients **0/0**, organizations/folders/
initiatives **13/17/193**, documents/versions **15/0**, jobs/chat messages/comments
**258/141/2124**, cutovers **17**, generations/MCP servers/registrations/leases
**0/0/0/0**. This includes all original authority data; no rows were exposed.

SHA-256 manifests, ordered by `schema.table`, LF-terminated:

| Manifest | Baseline | First = second |
| --- | --- | --- |
| `schema.table\|count` | `23e67eac9e2560d5514d8f91de88b1b29a2335871df73025eeb7e152e49f262d` | `64b7ad451b4685bc2bf9c361805de3c3033f661d0fcea0615f6f405ff5c30e76` |
| `schema.table\|COPY-sha256` | `74f9058b19d3eca4a149fa90246b6cda5a9aceb3a42b0278073d01240b01d86d` | `f6a35756c6bf081ab9b7bcdb6d71e2fbaa1e65af3409ab8b4ec2972edf500025` |
| Normalized schema | `6fefafdacef39b8b03f61f6ee69a667cc7415a42da172b4a4e7b77bd840faaf0` | `b6af096481bbcc0c5327e5fcc1b6b4844eb0df3be7b214e74de9f5df4956c333` |

`cmp` of the complete first/second aggregate snapshots exits **0**; both files
SHA-256 `959b6b7cf9602bf4559f1508a1400511b5976876d87e97b88536e71545a3db04`.
Thus all **114** table counts and data hashes, both journals and schema are
unchanged by the second run. The baseline schema hash also equals W0's hash.

## Cleanup and proof boundary

`make down` then project-scoped `make clean` completed. Label-filtered checks:
**0 containers, 0 volumes, 0 networks** for this project. Dump hash rechecked
before deletion; matching dump paths remaining **0**, kubeconfig scratch
directories remaining **0**. Temporary full operational logs were deleted.

This proves local restore and API migration idempotency for these fresh baseline
bytes. It does not qualify the scheduled S3 object, private blobs, production
role grants, live revoked-reader enforcement, serving activation or promotion.
Schema rollback remains additive: keep flags `0`, revert images/config, retain
the new tables, nullable unique column, journals, receipts and blobs; no down
migration or journal rewind. Other review/product/activation gates stay separate.
