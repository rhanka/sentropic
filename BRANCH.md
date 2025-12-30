# Fix: production streaming (SSE) + DB switch (Scaleway)

## Summary
Fix production-only streaming issues by:
- Making UI SSE URL construction compatible with relative API base (`/api/v1`) used behind Nginx/static builds.
- Switching away from Scaleway Serverless Postgres (SDB) because it does **not** propagate `LISTEN/NOTIFY`, which the SSE server depends on.
- Adding API support for custom DB CA certificates (TLS) to connect to the new managed Postgres without disabling verification.
- Updating backup tooling (`make db-backup-prod` + CI) to work with TLS strict mode (`verify-full`) using `DB_SSL_CA_PEM_B64`.

## Root Causes
- **Local prod UI**: `new URL('/api/v1/...')` throws in browsers → no SSE request.
- **Prod GH+Scaleway**: SDB breaks cross-session `LISTEN/NOTIFY` → SSE connection stays alive (ping) but never receives events.
- **Managed DB TLS**: Node rejects CA (`DEPTH_ZERO_SELF_SIGNED_CERT`) unless CA is provided.

## Changes
- **UI**: `ui/src/lib/stores/streamHub.ts`
  - Build SSE URL using `new URL(<pathOrUrl>, window.location.origin)` to support relative `VITE_API_BASE_URL`.
- **API TLS**: `api/src/db/client.ts`, `api/src/config/env.ts`
  - Added env support: `DB_SSL_CA_PEM`, `DB_SSL_CA_PEM_B64` (and reuse `DB_SSL_REJECT_UNAUTHORIZED`).
- **Backup/CI**: `Makefile`, `.github/workflows/ci.yml`
  - `make db-backup-prod` now requires `DB_SSL_CA_PEM_B64` and forces `PGSSLMODE=verify-full` + `PGSSLROOTCERT`.
  - CI passes `DB_SSL_CA_PEM_B64` to the backup step.
- **Restore tooling**: `Makefile`
  - `db-restore` post-restore inspection updated to use `organizations` table (schema alignment).

## How to Deploy / Validate
- **Scaleway API container env**:
  - Set `DATABASE_URL` to the managed DB with `?ssl=true` (password URL-encoded).
  - Set `DB_SSL_CA_PEM_B64` (base64 of the CA PEM).
- **Checks**:
  - `/api/v1/health` OK
  - `/api/v1/streams/sse` emits events beyond `ping` during chat/tool activity (e.g. `content_delta`, `folder_update`).

