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

## A6. One-time device credential exchange (INV-06)

Fresh RAM device-code pairing yields a full product session, which is NOT a
device-limited credential. `POST /api/v1/cowork-devices/exchange` converts it,
in ONE transaction: product session valid → owner allowed → activation enabled
and bound to this `device:<sessionId>` → registration active. Effects: 32
random bytes generated (gateway secret); its SHA-256 hex stored with a
generation and `exp = min(registration, activation)`; the exchange marked
consumed; the `user_sessions` row deleted (session AND refresh revoked) BEFORE
the response. The secret is returned once; loss or failure means a new
pairing, never a product-session fallback. Gateway auth uses
`X-Cowork-Device-Key: <base64url of the 32 bytes>` (never URL); the gateway
secret is refused by product routes, device approve, the IdP session resolver
and the MCP endpoint, and OAuth bearers are refused by gateway routes. The
gateway secret lives in agent RAM only (pilot debt, bounded to the week).

## A7. MCP tool catalog (target state; Lot 1 serves `tools/list` empty)

No `deviceId` argument anywhere (INV-08): the server resolves the unique armed
device of the owner; a second device is refused. MCP carries metadata, short
UTF-8 text (max `COWORK_MCP_MAX_TEXT_BYTES`) and reduced images only (INV-24);
binary bytes travel the portal/gateway only. Slow effects answer `pending` +
`action_status` when the 35 s MCP bound would be exceeded (INV-30).

| Tool | Arguments | Returns | Limit notes |
| --- | --- | --- | --- |
| `screen_capture` | `{region?: {x_image,y_image,w,h}, scale?: 1\|2}` | `{captureId, mime, data_base64, imageWidth, imageHeight, screenWidth, screenHeight, originX, originY, scaleX, scaleY, dpi, capturedAt}` | Target ~100 KB, hard cap 256 KiB (Lot 3 geometry) |
| `action_prepare` | `{tool: string, arguments: object}` | `{operationId, status: prepared, expiresAt}` | No effect; args sealed by HMAC digest (B1) |
| `input_action` | `{operationId}` (sealed `{captureId, x_image, y_image, kind, text?, key?}`) | receipt or `pending` | Capture max 5 s old; typing max 128 chars (Lot 3) |
| `shell_exec` | `{operationId}` (sealed `{ruleId, ruleVersion, argv[], cwdRef, envKeys[]}`) | receipt `{exitCode, bytesOut, truncated, timeout, partialEffect}` | Allow-list rule only; 10 s default / 20 s max; 16 KiB out (Lot 4) |
| `action_status` | `{operationId}` | `{status, receipt?}` | Same receipt for the same id (B1) |
| `action_cancel` | `{operationId}` | `{status: cancelled}` | Within its scope only (B3) |
| `file_begin` | `{direction, nameRef, sizeBytes, sha256, chunkHashes[]}` | `{transferId, chunkSize, manifest}` | 1 GiB file / 2 GiB quota / one active per direction (C1) |
| `file_status` | `{transferId}` | `{state, bitmap, receivedBytes}` | Resume from bitmap (C1) |
| `file_commit` | `{transferId}` | `{state: completed}` | Only after destination ACK (C1) |
| `file_abort` | `{transferId}` | `{state: aborted}` | Purge follows (C1) |
| `file_list_outgoing` | `{}` | `[{handle, sizeBytes}]` | Opaque handles + sizes (C1) |
| `file_text_get` / `file_text_put` | `{handle, offset?, length?}` / `{handle, text}` | `{text}` / `{receivedBytes}` | Behind `COWORK_FILE_TEXT_ENABLED=false` until BR41d-Q5 passes |

## A8. Windows native baseline (desk research, Lot 0; confirmed by `doctor` 3.1)

Constraint: no new unsigned third-party native binary unless recorded in
BR41d-A7; OS built-ins (`query session`, `taskkill /T /F`, `icacls`,
`fsutil`) and node built-ins need no exception. Guaranteed baseline (pure JS +
in-closure natives `screenshot-desktop@1.15.4`, `@nut-tree-fork/nut-js@4.2.6`
with `jimp@0.22.10` for the Lot 3 encoder): screen-corner presence poll +
tray-equivalent console surface + Ctrl+C fallback for the kill switch;
`query session` polling for lock/logoff/user-switch disarm; nut-js screen
bounds/DPI and active-window identity; `taskkill` tree-kill baseline under the
Job Object objective; path-policy refusal of `:`/ADS/traversal by name rule.
A `RegisterHotKey`/`LLMHF_INJECTED`/Job-Object helper is adopted only if a
source-built path exists; if the policy surface cannot be protected the agent
stays disarmed (INV-14). Capture encoder preference: `jimp` (already in the
exe closure via nut-js, declared explicit optional at the locked version) over
`jpeg-js@0.4.4` / `pngjs@6.0.0`; must run inside the `@yao-pkg/pkg` single exe
with a clean SCA (BR41d-Q8).

## B1. Operation model (INV-09, INV-10)

States: `prepared → queued → executing → completed | denied | cancelled`;
`executing → indeterminate` on crash between effect and receipt. Legal
transitions only; unknown or expired ids never execute. `action_prepare` has no
effect and returns an opaque 128-bit `operationId` (TTL 5 min, bounded by token
`exp` and policy end) with arguments sealed by an HMAC-SHA256 digest keyed by
`COWORK_OPERATION_HMAC_KEY` (never a bare hash) over canonical JSON; modified
arguments are rejected. Scope = tier + owner + clientId + device + policyRev.
The same `operationId` returns the same status or receipt (retry with a new
JSON-RPC id is safe); JSON-RPC ids are never keys. A crash between effect and
receipt is `indeterminate`: no automatic retry, new writes refused while
unresolved locally, an API restart cancels unclaimed jobs and never replays
payloads (payloads live in RAM only), a late ACK opens no grant, no late
content after revocation, an OAuth reconnection never reopens an operation of
an expired `jti`. No exactly-once claim. Receipts and tombstones are kept 7
days after close.

## B2. Broker: claim, lease, permit, result (INV-07, INV-11)

One action in flight per device. The agent long-polls
`GET /api/v1/cowork-devices/jobs/next` (max 25 s); the server atomically claims
with a lease of 30 s bound to generation + nonce. A permit is valid 2 s and is
issued only after fresh revocation, stop and activation reads
(`POST /api/v1/cowork-devices/jobs/:jobId/permit`). The agent checks epochs,
deadline and Windows session, then durably marks `executing` before the
primitive; lease renewal never re-runs a primitive. Results post to
`.../jobs/:jobId/result` (receipt; late ACK appended without new grant).
Every gateway request re-checks owner, device key `device:<sessionId>`,
generation, active credential hash, `policyRev` and effective expiry on each
poll, claim, permit, result and chunk; an opaque id never authorizes by
itself. MCP responses over 35 s become `pending` + `action_status` (INV-30).

## B3. Stops (INV-12)

Three distinct stops. (1) OAuth revocation closes the jobs and transfers of
that `jti` without waiting for `exp`. (2) `notifications/cancelled` is ignored
with 202; `action_cancel(operationId)` cancels within its scope. (3) Cowork
stop `POST /api/v1/cowork-control/stop` (owner cookie + anti-CSRF token in
header + strict Origin; SameSite=Lax alone is not enough on sibling
`*.sent-tech.ca` origins) durably disables activation and grants, increments
the epoch and cancels permits. A 5 s watchdog sweeps revoked `jti`, stop and
expiry, and closes pending queues; a daily purge drops receipts, tombstones
and audit rows closed more than 7 days. A ConfigMap change alone is not a
kill switch. Local-arm stops (INV-15, INV-18): lock, logoff, restart and user
switch disarm; re-arm needs a local action and keeps the chosen duration;
global hotkey (corner reserve if the hook is unavailable; Ctrl+C console
fallback only) and notification-area button kill the process tree, release keys
and buttons in `finally`, and notify the server best effort; network loss
forbids any next effect.

## B4. Policy record (INV-13, INV-16)

Capabilities are distinct (capture, keyboard/mouse, file in, file out,
shell/exec); none enabled implicitly. Durations: entered, until lock, or
unlimited with explicit confirmation and a "revocable, pilot until …" recap;
unlimited never extends J+7. Any scope or YOLO change is a new revision needing
a new local acceptance. Acceptance trace: policyId, revision, ownerSub,
Windows SID, device, tier, local actor, acceptedAt UTC, canonical scope,
ruleSetDigest, durationMode, expiresAt or null, pilotExpiresAt, revokedAt and
reason, epochs. The server keeps only the canonical redacted scope + digest:
no secrets, no raw paths. No tool can read-to-modify, accept or arm a policy;
while the local policy surface is open, remote claims pause, agent input
injection is disabled, exec children are blocked and injected input events are
rejected; if the surface cannot be protected the agent stays disarmed (INV-14).

## B5. Shell rules (INV-19, INV-20, INV-21)

Named rule (ruleId + version): absolute canonical executable with expected hash
or signer; typed argv (literals and anchored patterns, max length); no
implicit shell; cwd inside an approved root without reparse points; rebuilt
minimal environment; secrets by local reference only. Rule and file
re-evaluated just before spawn. PowerShell/cmd only through immutable hashed
local scripts with typed parameters (`-NoProfile -NonInteractive -File
<verified script>`); `-Command`, `-EncodedCommand`, free `/c` strings and free
metacharacters refused. Rules authored only on the local surface, never
prefilled from model suggestions. Bounds: timeout default 10 s, max 20 s;
stdout+stderr max 16 KiB UTF-8 with announced truncation; Job Object
kill-on-close, no detached child, stdin closed, environment not inherited, no
elevation; timeout or stop kills the tree and returns a receipt that may state
a partial effect. YOLO: visible "Allow everything (YOLO) — not recommended",
never default, explicit local activation with a risk recap (stating YOLO audit
cannot reconstruct commands) and a dedicated audit event; removes only the
allow-list (timeouts, caps, kill, identity, J+7 end stay); no silent exemption
for a refused command.

## B6. Audit (INV-22, INV-23)

Row fields: operationId, ruleId/version, executable or script identity hash,
schema-allowed non-sensitive params, cwdRef/envKeyRefs, policyRev, actor,
times, duration, exitCode, byte counts, timeout/truncation flags. NEVER: raw
command, argv, cwd, env, stdout/stderr, images, typed text, file names, paths,
tokens, or bare hashes of low-entropy text. YOLO rows carry the executable and
`raw-command-redacted`. HTTP paths carry opaque ids only; secrets only in
headers; error traces redacted. Capture/input/file effects are audited through
their operation receipts; exec rows follow the field rule above. Durability:
the audit table is append-only (UPDATE refused, DELETE only by the TTL purge 7
days after close, enforced by trigger — BR41d-A2); an audit write failure
blocks new admissions via the audit-health signal consulted by admission.
