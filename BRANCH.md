# Fix: UI streaming + reactive updates (production-only)

## Objective
Investigate and fix (minimal scope) two UI issues that reproduce only in production builds:
- Streaming (SSE) does not work in compiled/static UI (chat + cards).
- Views are not reactively updated after tool-driven updates in chat (SSE events may exist but UI does not refresh consistently).

Constraints:
- Initially started with **analysis-only** and preference for config/proxy/build fixes.
- Keep changes minimal and aligned with `.cursor/rules/*.mdc`.

## Current Branch
- `fix/ui-streaming-production`

## Context (Known Facts)
- Dev mode (SvelteKit dev server, non-compiled) streaming works.
- Production GH Pages (static SPA) + Scaleway (API serverless):
  - SSE connection exists, but UI does not display streamed events.
  - Root cause identified: Scaleway Serverless Postgres (SDB) does not propagate `LISTEN/NOTIFY` across sessions (SSE server relies on it).
  - New managed Postgres instance was created and data copied; `LISTEN/NOTIFY` probe succeeds on the managed DB.
  - Switching production DB requires TLS; the managed DB uses a CA that must be provided to Node.js (otherwise `DEPTH_ZERO_SELF_SIGNED_CERT`).

## Fixes (Implemented)
- **Fix: SSE URL construction supports relative `VITE_API_BASE_URL` (local production)**
  - **Files changed**:
    - `ui/src/lib/stores/streamHub.ts`
  - **Root cause**:
    - In local production, the UI is built with `VITE_API_BASE_URL=/api/v1` (relative) so normal API calls go through the same-origin Nginx proxy.
    - Regular API calls work because `fetch('/api/v1/...')` is valid, but SSE code used `new URL('/api/v1/...')` which throws in browsers without a base → **no SSE request was made**.
  - **Change implemented**:
    - Before (broken with relative base):
      - `new URL(\`\${API_BASE_URL}/streams/sse\`)`
    - After (works with relative or absolute base):
      - `new URL(\`\${API_BASE_URL}/streams/sse\`, window.location.origin)`
  - **Validation**:
    - Local production no longer throws `Failed to construct 'URL': Invalid URL` from `ensureConnected`.
    - Local production now streams successfully (SSE request is created and events are received).

- **Fix: API supports custom DB CA certificate for TLS**
  - **Files changed**:
    - `api/src/db/client.ts`
    - `api/src/config/env.ts`
  - **Problem**:
    - When pointing `DATABASE_URL` to the new managed Postgres with `?ssl=true`, Node/Postgres client fails with:
      - `DEPTH_ZERO_SELF_SIGNED_CERT`
  - **Change implemented**:
    - Added optional env vars to provide the CA certificate:
      - `DB_SSL_CA_PEM` (raw PEM)
      - `DB_SSL_CA_PEM_B64` (base64 PEM; recommended for secret stores)
    - `DB_SSL_REJECT_UNAUTHORIZED` remains supported (default: true).
  - **How to deploy (Scaleway Container env)**:
    - Set `DATABASE_URL` (password must be URL-encoded) and include `?ssl=true`.
    - Set `DB_SSL_CA_PEM_B64` to the base64-encoded PEM.

## Remaining Problem (GH Pages + Scaleway)
SSE connection exists, but streamed events are not visible in the UI (when API uses SDB).
With the managed DB + working `LISTEN/NOTIFY`, SSE is expected to work without polling.

## Production Switch Checklist (Scaleway + CI)
- **Scaleway Container (runtime API)**:
  - Update container env var `DATABASE_URL` to the new DB:
    - include `?ssl=true`
    - URL-encode the password (special chars)
  - Add `DB_SSL_CA_PEM_B64` (base64 PEM).
  - Redeploy the API image so the new TLS env support is present.
  - Validate:
    - `/api/v1/health`
    - `/api/v1/streams/sse` shows events beyond `ping` during chat/tool updates.
- **GitHub Actions (CI)**:
  - CI currently uses `secrets.DATABASE_URL_PROD` only for `make db-backup-prod` in `test-smoke-restore`.
  - If you want CI backup/restore to target the new DB, update `secrets.DATABASE_URL_PROD` accordingly.
  - If CI needs strict TLS verification with the managed DB CA, add a new secret (e.g. `DB_CA_PEM_B64`) and adjust the backup step to mount/write the PEM and set `PGSSLROOTCERT`/`PGSSLMODE=verify-full` (optional; can also use `sslmode=require` if acceptable).
