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

## Remaining Problem (GH Pages + Scaleway)
SSE connection exists, but streamed events are not visible in the UI.

## Working Hypotheses (GH Pages + Scaleway)
#### B1) Proxy/LB buffering between client and API
- **Why**:
  - SSE must flush chunks; intermediary proxies can buffer, compress, or time out.
  - API sends SSE headers including `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` (helpful for Nginx, not always for managed LB).
- **How to confirm**:
  - In browser, open the SSE request and verify whether pings arrive every ~1s.
  - If connection is “open” but no pings: strong sign of buffering upstream.
  - Inspect response headers for `content-encoding` (gzip/br) and caching.

#### B2) CORS/credentials mismatch (depends on deployment domain topology)
- **Why**:
  - SSE is opened with `withCredentials: true`; cross-origin requires correct CORS with credentials.
  - API CORS is strict: it echoes `Access-Control-Allow-Origin: <Origin>` only if origin is allowlisted; it sets `Access-Control-Allow-Credentials: true`.
  - Any proxy injecting `Access-Control-Allow-Origin: *` (with credentials) is invalid and can cause silent failures.
- **How to confirm**:
  - Check SSE response headers:
    - `Access-Control-Allow-Origin` must be the exact UI origin (not `*`) when credentials are used.
    - `Access-Control-Allow-Credentials: true` must be present.
  - Check if cookies are sent to the API domain and accepted.

### C) “Reactive updates not applied after chat tools”
This likely has two layers:
1) Are SSE events actually received in production? (depends on A/B)
2) If received, are they dispatched and causing stores/components to refresh?

Given the current reports, step (1) must be solved first; otherwise reactivity can only rely on fallback polling.
