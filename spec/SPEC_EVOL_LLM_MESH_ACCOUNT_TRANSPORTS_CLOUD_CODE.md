# SPEC EVOL - LLM Mesh Account Transports — Cloud Code (AGY) Native Enrollment

Status: Active — branch feat/llm-mesh-agy-enrollment (BR-XX).

**This file extends `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` with the Cloud Code
(Antigravity / daily-cloudcode) native enrollment and runtime. It will be merged into
the parent spec at Lot N-1 (docs consolidation) and then deleted.**

Aligned with: `h2a` spec `docs/specs/llm-mesh-enrollment-v0.6.md` (commit `6eb2d24c`).

Related specs: `SPEC_EVOL_LLM_MESH.md`, `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`.

---

## Context — Why this extension

`SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md` planned `gemini-code-assist` as the
Google product-account transport (D1, Family Matrix line 3). That entry is superseded
by this extension:

- **`gemini-code-assist`** — removed from `accountTransportProviderIds`. Legacy B2B
  enterprise GCP/Vertex offering; no active enrollment path exists. Kept only as a
  historical reference in this spec.
- **`cloud-code`** — new canonical transport id for Antigravity / Google daily-cloudcode
  product accounts. Wire-proven via mitmproxy (see §7). Target provider: `gemini`.

The naming decision (h2a commit `6eb2d24c`): "Antigravity" is the official Google
product name (since Google I/O 2026-05-19). The CLI binary is `agy`. `cloud-code`
is the stable transport id (brand-resilient per D15).

---

## Decisions — extensions and overrides to parent spec

### D1 override — Cloud Code replaces gemini-code-assist in the transport family

Updated Account Transport Family Matrix row:

| Target provider | Account transport id | Product account source | Wire path | Status |
|---|---|---|---|---|
| `gemini` | `cloud-code` | Antigravity / Google Cloud Code account OAuth | `daily-cloudcode-pa.googleapis.com` (proven mitmproxy) | **This branch** |

`gemini-code-assist` is removed from `accountTransportProviderIds` and
`executableAccountTransportProviderIds`. It must not appear in `futureAccountTransportProviderIds`
either — it is simply gone. Any existing DB rows or config referencing
`gemini-code-assist` as transport are invalid after migration.

### D2 — Package boundary (reinforces parent D2)

`@sentropic/llm-mesh` remains **transport-less and storage-less**:

- Zero `fetch`, zero SSE parsing, zero keyring access in `packages/llm-mesh/src/`.
- The package exports **types and interfaces only** for: `EnrollmentSession`,
  `EnrollmentProvider`, `LlmMeshFacade`, `ProviderAdapter`, `CloudCodeRuntimeMetadata`,
  `KeyringAdapter`, `LocalAccountTransportService` (interface/signatures).
- Implementations of network calls (`cloud-code-transport.ts` HTTP+SSE) and storage
  (`LocalAccountTransportService` concrete, `KeyringAdapter` Linux/macOS/env) live in
  `api/src/services/providers/` (portal) or are injected by `h2a-runtime` (CLI).

### D13 — Cloud Code readiness ladder

Cloud Code moves to `app-executable` in this branch:

1. `proven` ✅ — wire facts validated mitmproxy (§7).
2. `package-executable` — Lot 1 gate: `@sentropic/llm-mesh/facade` compiles; h2a mock import OK.
3. `app-executable` — Lot 2 gate: enrollment + refresh + acquire working end-to-end.

### D17 (new) — Facade is the single integration boundary for h2a

h2a imports **only** `@sentropic/llm-mesh/facade`. It never calls `start()`,
`complete()`, `resolve()`, or `refresh()` directly. The facade owns the full
enrollment state machine internally.

### D18 (new) — 0-token session boundary (Q3A)

`SessionEntry` in h2a carries only `transportConstraints` (non-secret). No token,
no `GATEWAY_ACCOUNTS`, no env durable token. `service.acquire()` is called at every
request and sentropic provides the live token. Rotation and expiry are invisible to h2a.

### D19 (new) — abort = release, not outcome (Q2B)

`abort` signal → `facade.release(acquisition)`: releases the reservation with 0 impact
on account health. All other request terminations (200, 401/403, 429, SSE error)
generate exactly one outcome via `execute()` (sentropic-owned). h2a never calls
`recordOutcome()` directly.

---

## Package structure changes (Lot 1 + Lot 2)

```
packages/llm-mesh/src/
  enrollment/
    contracts.ts          — NEW: EnrollmentSession, EnrollmentState (internal),
                                 StartEnrollmentInput, PreparedCredential,
                                 ResolvedProviderMetadata, EnrollmentProvider interface
    cloud-code.ts         — NEW: CloudCodeEnrollmentProvider (PKCE loopback,
                                 waitForCallback, cancel) — adapted from
                                 api/src/services/antigravity-provider-auth.ts
    codex.ts              — NEW: CodexEnrollmentProvider (device flow, pollForCompletion)
    claude-code.ts        — NEW: ClaudeCodeEnrollmentProvider (portal-only, local UNSUPPORTED)
    pkce.ts               — NEW: PKCE helpers + loopback HTTP server (Node host only)
    device-poll.ts        — NEW: Codex device-flow polling (Node host only)
  service/
    facade.ts             — NEW: LlmMeshFacade interface + createLlmMeshFacade()
    local-account-transport-service.ts  — NEW: interface + signatures (Lot 1);
                                           full impl (Lot 2)
  transport/
    cloud-code-transport.ts  — NEW: daily-cloudcode request builder + SSE converter
                                    + outcomes (impl in api/, interface here)
  auth.ts                — CHANGED: remove gemini-code-assist, add cloud-code,
                                    add CloudCodeRuntimeMetadata + isCloudCodeRuntimeMetadata
  account-transports.ts  — UNCHANGED (coordinator port stays as-is)

packages/llm-mesh/package.json
  exports added:
    "./facade"             → src/service/facade.ts
    "./enrollment"         → src/enrollment/contracts.ts
    "./node"               → src/node/index.ts  (keyring + pkce-server, Node-only)
    "./transport/cloud-code" → src/transport/cloud-code-transport.ts
```

---

## `auth.ts` changes (Lot 1)

```typescript
// REMOVE gemini-code-assist entirely
// REMOVE futureAccountTransportProviderIds

export const accountTransportProviderIds = [
  'codex',
  'cloud-code',   // NEW — replaces gemini-code-assist
  'claude-code',
] as const;

export const executableAccountTransportProviderIds = [
  'codex',
  'cloud-code',   // NEW
  'claude-code',  // portal OK, h2a local UNSUPPORTED
] as const;

// NEW — type guard at execution boundary (3 fields, non-empty strings)
export interface CloudCodeRuntimeMetadata {
  cloudaicompanionProject: string;
  cloudCodeUserAgentVersion: string;
  authClientConfigVersion: string;
}
export const isCloudCodeRuntimeMetadata = (m: unknown): m is CloudCodeRuntimeMetadata =>
  typeof m === 'object' && m !== null &&
  typeof (m as any).cloudaicompanionProject === 'string' && (m as any).cloudaicompanionProject.length > 0 &&
  typeof (m as any).cloudCodeUserAgentVersion === 'string' && (m as any).cloudCodeUserAgentVersion.length > 0 &&
  typeof (m as any).authClientConfigVersion === 'string' && (m as any).authClientConfigVersion.length > 0;
```

---

## Enrollment types (Lot 1 — `enrollment/contracts.ts`)

```typescript
// Returned to h2a — h2a opens browser or displays userCode only
export type EnrollmentSession =
  | { kind: 'authorization-url'; enrollmentId: string; url: string; expiresAt: string }
  | { kind: 'device-code'; enrollmentId: string; verificationUrl: string;
      userCode: string; pollIntervalMs: number; expiresAt: string };

// Persisted server-side only — NEVER exposed to h2a
interface EnrollmentState {
  enrollmentId: string;       // ULID
  providerId: 'cloud-code' | 'codex' | 'claude-code';
  ownerScope: string;         // 'cli:hostname' or portal userId
  pkceVerifier: string;       // S256 — sentropic server secret
  pkceState: string;          // CSRF nonce
  redirectUri: string;        // validated at creation
  configVersion: string;      // version at start() time
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;        // single-use — idempotent after
  cancelledAt?: string;
}

export interface StartEnrollmentInput {
  configRef: string;          // vault ref — never the secret itself
  mode: 'cli' | 'portal';
  redirectUri: string;
  ownerScope: string;
}

// Internal sentropic use only — h2a NEVER calls complete() directly
interface CompleteEnrollmentInput {
  enrollmentId: string;
  code: string;               // received by sentropic-owned loopback
}

export interface PreparedCredential {
  accountId: string;          // generated ULID
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  authClientConfigVersion: string;  // version bound at enrollment
  accountEmail?: string;
}

// Internal — LocalAccountTransportService use only
interface RefreshInput {
  accountId: string;
  credentialVersion: string;  // resolves HISTORICAL config — no hot-reload
}

export interface ResolvedProviderMetadata {
  cloudaicompanionProject?: string;   // Cloud Code
  cloudCodeUserAgentVersion?: string; // Cloud Code
  [key: string]: unknown;
}
```

Atomic transaction after successful `complete()`:
1. `resolve()` → `ResolvedProviderMetadata` (failure → `reauth_required`, throw)
2. Persist `AccountPublic` + `CredentialEnvelope` atomically
3. `status` → `'active'`
None of these steps is individually exposed to h2a.

---

## Facade interface (Lot 1 — `service/facade.ts`)

```typescript
// ONLY interface imported by h2a
export interface LlmMeshFacade {
  // CLI enrollment
  enroll(providerId: 'cloud-code' | 'codex' | 'claude-code', input: StartEnrollmentInput): Promise<EnrollmentSession>
  waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }>  // Cloud Code
  pollForCompletion(enrollmentId: string): Promise<{ accountId: string; label: string }> // Codex
  cancel(enrollmentId: string): Promise<void>

  // Runtime gateway (Q3A — acquire per request, 0 token in SessionEntry)
  acquire(input: AccountTransportAcquireInput): Promise<AccountTransportAcquisition>
  release(acquisition: AccountTransportAcquisition): Promise<void>  // Q2B abort

  // Provider adapter
  getAdapter(providerId: 'cloud-code' | 'codex' | 'claude-code'): ProviderAdapter
}

export interface ProviderAdapter {
  // execute() calls recordOutcome() automatically — h2a never calls recordOutcome()
  execute(
    acquisition: AccountTransportAcquisition,
    request: ProviderRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>
}

export interface FacadeOptions {
  configResolver: ConfigResolver;  // resolves vault refs → ProviderSecrets
  keyring?: KeyringAdapter;        // injected by h2a-runtime/node
  mode: 'cli' | 'portal';
}

export interface ProviderRequest {
  modelId: string;
  contents: unknown[];
  generationConfig?: unknown;
}

export type ProviderEvent =
  | { kind: 'content'; delta: string }
  | { kind: 'done'; usage: unknown }
  | { kind: 'error'; code: string; message: string };

export function createLlmMeshFacade(options: FacadeOptions): LlmMeshFacade;
```

---

## Wire facts Cloud Code (validated mitmproxy — §8 of h2a v0.6 spec)

**resolve()** — MANDATORY before activation (absence → `reauth_required`)
```
POST daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
Authorization: Bearer {access_token}
User-Agent: antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)
{"metadata": {"ideType": "ANTIGRAVITY"}}
→ { cloudaicompanionProject }   — no fallback 'default-cli-project'
```

**execute()** — request format
```json
POST daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse
Authorization: Bearer {access_token}
User-Agent: antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)
{
  "project": "{cloudaicompanionProject}",
  "requestId": "{uuid}",
  "model": "{modelId}",
  "userAgent": "antigravity",
  "request": { "contents": [...], "generationConfig": {...} }
}
```

**Outcomes (Q2B — executed by execute(), never by h2a)**
```
200 OK              → success (after full SSE consumption)
401 / 403           → auth_failed → reauth_required this account only
429 + Retry-After   → rate_limited + retryAfterMs → cooldown
SSE error           → failed
abort               → facade.release(acquisition) — 0 outcome
```

**OAuth refresh**
```
POST https://oauth2.googleapis.com/token
grant_type=refresh_token
&refresh_token={refresh_token}
&client_id={client_id}          ← same version as at enrollment
&client_secret={client_secret}
→ { access_token, expires_in: 3599 }
```

Secrets (`client_id`, `client_secret`) extracted from AGY binary by CI/CD job per
release, never hardcoded in source. Each account carries `authClientConfigVersion`
binding the credentials used at enrollment. Refresh resolves historical version.

---

## Migration from gemini-code-assist

- Remove `'gemini-code-assist'` from `accountTransportProviderIds` in `auth.ts`.
- Remove `futureAccountTransportProviderIds` entirely.
- Any existing account rows with `transportProviderId = 'gemini-code-assist'` are invalid
  and must not be acquired. Migration script marks them `revoked`.
- Test: `gemini-code-assist` rows remain untouched by the new `cloud-code` enrollment
  path (isolation verified).

---

## Acceptance criteria (additions to parent spec §Required Tests)

1. **Cloud Code fixtures** — refresh form-urlencoded, UA exact for `loadCodeAssist`,
   no project fallback, daily-cloudcode envelope correct, requestId UUID unique,
   abort=release, SSE/error/outcome
2. **OAuth** — PKCE S256, state/nonce mismatch, replay/expiry/cancel, provider denial,
   rotation, retired historical config-version → explicit error, 0 secret in logs
3. **Multi-tenant** — two users cannot acquire each other's account (SQL/RLS, not
   in-memory filter)
4. **Concurrency** — single refresh per account, multi-instance (CAS/DB portal)
5. **Migration** — `gemini-code-assist` rows untouched by `cloud-code` enrollment
6. **h2a acceptance** — enrollment + refresh without CLI provider present;
   `waitForCallback` receives `accountId`, never `code`
7. **Claude local** — explicit error, no silent fallback
8. **Compilation** — h2a consumer compiles against `/facade` exports; 0 deep imports
9. **h2a boundary** — `SessionEntry` without token; 0 sentropic token in JSON/env;
   `acquire → execute → release/outcome` without GCP fallback
10. **Refresh/persistence** — atomic rotation before `acquire()` returns; restart
    recovery; retired config-version → `reauth_required` this account only
11. **State machine** — `waitForCallback`/`pollForCompletion` never receive code;
    `cancel` idempotent; state/nonce validated; replay/timeout/cancel covered
12. **Outcomes Q2B** — abort → `release()` (0 outcome, 0 health impact);
    200/401/403/429/SSE error → exactly one outcome via `execute()`
13. **Data** — ULID immutable, project non-PK, `revoked` persistent non-acquirable,
    disconnect/revoke without touching native keyring
14. **Routing** — Cloud Code constraint → daily-cloudcode only; 0 degradation to Vertex

---

## Merge instructions (Lot N-1)

At branch close, merge this file into `SPEC_EVOL_LLM_MESH_ACCOUNT_TRANSPORTS.md`:

1. Replace Family Matrix line for `gemini-code-assist` with `cloud-code` line.
2. Update D1 to reflect `cloud-code` replacing `gemini-code-assist`.
3. Update D9 with Cloud Code refresh semantics (proven endpoint, history-pinned config version).
4. Update D10 with Cloud Code quota state (401/403/429/Retry-After).
5. Update D13 ladder: `cloud-code` = `app-executable` as of this branch.
6. Add D17, D18, D19 (facade boundary, 0-token session, abort=release).
7. Update Migration step 9: replace `gemini-code-assist` mention with `cloud-code`.
8. Merge §Required Tests with the 14 criteria above.
9. Delete this file.
