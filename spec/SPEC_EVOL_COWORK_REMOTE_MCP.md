# Cowork Remote MCP — implementation contract (BR-41d)

Status: contract. This file is the single source of truth for wire contracts,
limits, states and the pilot runbook. Code and tests follow it. French design
sources (git-ignored): `.h2a/inputs/cowork-remote-dossier-r2.json` (decisions
D1–D8, steps 0–7), `existing-state-cowork.md`, `owner-answers-r2.json`
(2026-10-06, D7=A + D8=A). Deviations are raised in `BRANCH.md ## Feedback
Loop`, never applied silently.

Conventions: `MUST`/`NEVER` are test-enforced. Tiers are `preprod` and `prod`
only. Times are UTC. `J+7` = `activationExpiresAt = activatedAt + 604800 s`.

## A1. Actors and trust

| Actor | Role |
| --- | --- |
| Owner | Sole human principal; personal workstation (D7=A); accepts the local policy in person at arming; keeps the Windows session open |
| Windows agent | `sentropic-cowork remote` on the owner workstation; enforces the local policy before every effect; disarms on lock/logoff/restart/user-switch |
| API | Serves `/api/v1/cowork-mcp` (MCP), `/api/v1/cowork-devices/*` (gateway), `/api/v1/cowork-control/*` + portal (owner cookie); never polls or replays |
| Authorization server | Tier IdP that mints OAuth access tokens; the API verifies locally via the JWKS port |
| Claude clients | claude.ai web (pilot-validated) and Claude Code (owner-confirmed at activation); connector tools on "Needs approval", dedicated conversation |
| Operator | Owns preprod/prod config, Secrets, static client rows, promotion and rollback; acts only with owner approval |

Tier isolation (INV-05): preprod tokens, clients, keys and resources are never
admitted in prod and the reverse. Tier derives from the configured resource
host; an unknown host disables Cowork.

| Tier | Resource (`COWORK_MCP_RESOURCE_URI`) | Authorization server |
| --- | --- | --- |
| preprod | `https://preprod.sentropic.sent-tech.ca/api/v1/cowork-mcp` | `https://preprod.auth.sent-tech.ca` |
| prod | `https://sentropic.sent-tech.ca/api/v1/cowork-mcp` | `https://auth.sent-tech.ca` |

## A2. Owner decisions (fixed)

D1=B real workstation under a local per-capability policy (entered duration,
until lock, or unlimited traced revocable; arming separate from acceptance;
lock/restart disarms). D2=A amended: screen, input, files AND shell/exec under
a local allow-list; YOLO explicit, off by default, never a general
anti-execution boundary. D3=B: 64 MB and more; 256 KiB HTTP chunks, 64 MiB
segments, logical file max 1 GiB, owner quota 2 GiB; bytes via the
authenticated portal, MCP carries ids and receipts only. D4=A: dedicated
`/api/v1/cowork-mcp` first; move under `/api/v1/mcp` as follow-up; reuse
`device:<sessionId>`, no second device registry. D5=B: brief preprod smoke
(5–10 min) then fast manual prod promotion; negative tests stay in the build
lots. D6: pilot activation lasts 7 days (604800 s, checked per request); RAM
gateway secret, unsigned binary and non-sealed audit are debt bounded to that
week. D7=A: owner personal workstation (answered 2026-10-06). D8=A: full pilot
steps 0–7 (answered 2026-10-06; estimate, not commitment).

## A3. Configuration (fail-closed, INV-03)

Resolved per request from `process.env` (tests toggle in-process). Flag not
`true`, or any required value missing/invalid, gives 404 on every Cowork route
(including the PRM) and starts no Cowork scheduler or watchdog.

| Key | Default | Fail-closed rule |
| --- | --- | --- |
| `COWORK_REMOTE_ENABLED` | unset (disabled) | Must be exactly `true`; any other value disables |
| `COWORK_MCP_RESOURCE_URI` | unset | Exact URI, no trailing slash; unknown tier host disables |
| `COWORK_MCP_AUTHORIZATION_SERVER_URL` | unset | HTTPS URL of the tier IdP; missing disables |
| `COWORK_MCP_ALLOWED_SCOPE` | `cowork:control` | Constant; changing it disables (single-scope pilot) |
| `COWORK_OWNER_SUB` | unset | Owner user id observed in that tier; missing disables |
| `COWORK_MCP_CLIENT_ID` | unset | Static client id of that tier; missing disables |
| `COWORK_OPERATION_HMAC_KEY` | unset | At least 32 random bytes (base64url); shorter disables |
| `COWORK_MCP_ALLOWED_ORIGINS` | unset (absent Origin accepted) | `https://claude.ai` accepted when present; any other Origin 403 (BR41d-Q4) |
| `COWORK_MCP_MAX_TEXT_BYTES` | `32768` | Short-text cap; lowered by config if the smoke requires (BR41d-Q5) |
| `COWORK_CAPTURE_TARGET_BYTES` | `102400` | Capture target; lowered by config if the smoke requires (BR41d-Q5) |
| `COWORK_FILE_STAGING_DIR` | unset | Private staging dir, never under a UI static dir; missing disables file tools only |
| `COWORK_FILE_TEXT_ENABLED` | `false` | `file_text_get`/`file_text_put` stay off unless BR41d-Q5 passes on both clients |
| `COWORK_MCP_BODY_LIMIT_BYTES` | `1048576` | MCP request body cap; over → 413 |

Secrets (`COWORK_OWNER_SUB`, `COWORK_MCP_CLIENT_ID`,
`COWORK_OPERATION_HMAC_KEY`) live in the per-tier operator Secret
`sentropic-cowork`, never in git; rotation invalidates pending prepares without
enabling replay (BR41d-Q6). `OAUTH_ISSUER_URL`, `MCP_RESOURCE_URI`,
`OAUTH_ACCESS_TOKEN_TTL_SEC`, nginx and the global cowork-desktop channel are
never changed by this work.

## A4. Discovery without nginx change (BR41d-Q13)

The canonical RFC 9728 §3.1 PRM URL
(`/.well-known/oauth-protected-resource/api/v1/cowork-mcp`) is inservable: the
product ingress routes `/` to the ui service and nginx proxies only
`^/api/v1/.*` to the API. The PRM is therefore served mount-relative at
`/api/v1/cowork-mcp/.well-known/oauth-protected-resource` and announced in the
401 via `buildWwwAuthenticate` (never `mcp.challenge()` or `requireMcpAuth`,
which point at the canonical URL). Extra canonical/legacy routes registered by
`mcpAuthRoutes` under the prefix are inoperative behind Hono and untested.

PRM document (exact): `resource` = `COWORK_MCP_RESOURCE_URI` (no trailing
slash); `authorization_servers` = [`COWORK_MCP_AUTHORIZATION_SERVER_URL`];
`scopes_supported` = [`cowork:control`]; `bearer_methods_supported` =
[`header`]. Enabled without token → `401` with
`WWW-Authenticate: Bearer [REDACTED]"<PRM URL>", scope="cowork:control"`.
GET/DELETE on the MCP path → 405 before the transport. Fallback if claude.ai
pre-probes the canonical URL instead of following `resource_metadata`:
owner/conductor decision recorded before the smoke (BR41d-Q13); default is a
failed smoke fixed through a new PR, never pilot improvisation.

## A5. Admission (INV-01, INV-02, INV-05)

After `mcp.verify(req, { requiredScopes: ['cowork:control'] })`, in order:
`jti` + `exp` present → `sub` equals `COWORK_OWNER_SUB` and `client_id` equals
`COWORK_MCP_CLIENT_ID` → `findTokenMeta(jti)` present, unexpired, audience
equals the resource → `isTokenRevoked(jti)` is false → `findClient(clientId)`
present with `cowork:control` in `allowedScopes` and the resource in
`resourceIndicators` → owner row `account_status=active` and `disabled_at`
null. Output `{tier, ownerSub, clientId, jti, exp}` for later binding.
"Client active" = row present + scope + resource (no active column exists);
revocation = re-register without `cowork:control` or delete the row (BR41d-A3).

Error mapping: credential failures → 401/403 + `WWW-Authenticate`
(`invalid_token`; `insufficient_scope` with `scope="cowork:control"` when only
the scope is missing). Any store exception → `503
{error:{code:admission_unavailable}}` with NO challenge (a 401 would push
Claude into a reconnect loop). Method errors after admission → JSON-RPC errors.
No positive admission cache: revocation, client and owner are read fresh on
every admission; the 60 s JWKS key-material cache is not an admission cache.
