# SPEC_EVOL — ARCH-02 Public app auth and anonymous quotas (BR-53) — SCOPING v1

Status: **SCOPING v1** — produced under the repo's double adversarial review cadence
(**Opus 4.8 xhigh + Codex 5.6-terra xhigh**, independent, CONVERGED on the headline and on every
load-bearing decision; where they differed, the better-grounded position is adopted and the divergence
is recorded in §6). Decision-oriented; every technical claim carries a `path:line` read from live code.
After this → detailed `BRANCH.md` from `plan/BRANCH_TEMPLATE.md` for the implementation lots.
Owner: `chore/arch02-public-app-auth-study` (BR-53, `PLAN.md:632`).
Registry: `spec/SPEC_EVOL_ARCHITECTURE.md:707` (ARCH-02).
Gates BR-62 (`PLAN.md:646`) — the `diag.sent-tech.ca` anonymous-first proof, i.e. the owner's
"mode no-auth + opt-in auth".

## 0. Headline — the BR-39n gate was FALSE and has been struck

`PLAN.md:632` gated BR-53 on "BR-39n claim-set decisions (IdP lane)". **Both evaluators independently
established that ARCH-02 needs no new IdP claim**, and production verification closed the last doubt.

- **Phase 1 (anonymous-first): ZERO IdP claims. Zero IdP interaction.**
- **Phase 2 (opt-in claim/recovery): a verified stable `sub` ONLY**, plus the standard verification
  material every RP must check anyway (`iss`, `aud`, signature, `exp`, `nonce`/`state`, PKCE). `sub` is
  the stable `users.id` (`packages/auth-hono/src/oauth/token-handler.ts:449`) — exactly the FK target
  every re-key site needs. It has been emitted since A0.
- **The claim ticket never traverses the IdP.** The IdP round-trips the RP's `state` **verbatim** to
  `redirect_uri` (`packages/auth-hono/src/oauth/issue-authorized-code.ts:51`), so the app keys the claim
  ticket SERVER-SIDE by its own `state`/`nonce` and redeems it at its own callback. Nothing needs to
  survive the redirect inside an IdP-controlled field → no new claim, no new scope, no IdP knowledge of
  claiming. `spec/SPEC_EVOL_ARCHITECTURE.md:276-280` ("co-owned with BR-39n") is satisfiable purely RP-side.
- **Root cause of the false gate:** `spec/SPEC_EVOL_ARCHITECTURE.md:76-77` and
  `apps/auth-idp/RP_SESSION_GLUE.md:99-103` were written BEFORE BR-39e landed the `tid` binding, and the
  plan inherited their stale premise. **Verified in production 2026-07-25:** `auth.sent-tech.ca`
  discovery returns `claims_supported = [sub, aud, iss, exp, iat, nonce, auth_time, acr, email,
  email_verified, name, tid]`. Corrected in PR #453.

**Still genuinely BR-39n** (and not needed by ARCH-02): a `role` claim, a membership-LIST claim, any
product-scoped authorization claim.

**The real IdP-side gap is NOT claims**: there is no RP session-glue PACKAGE — `createOAuthClient(...)
.exchangeCode()` stops at token return and the last mile (verify id_token against JWKS → mint the RP's
own cookie) is documented as "a recipe, not yet a package"
(`apps/auth-idp/RP_SESSION_GLUE.md:6-17`). That is ~40 lines of `jose`, product-side, phase 2.

## 1. Scope frame

**IN scope**: the guest principal (encoding, cookie, resolution middleware, CSRF/origin posture); the
claim token and the guest→account merge policy; the app-safe public chat surface; the router-factory
seam; the `CostContext` the quota ledger consumes.

**OUT of scope (cited, never redesigned)**: quota enforcement — ARCH-13 is complete and explicitly
"Unblocks ARCH-02 (anonymous quotas)" (`spec/SPEC_EVOL_QUOTA_LEDGER.md:53`); retention/erasure — ARCH-15
(BR-56, `spec/SPEC_EVOL_DATA_LIFECYCLE.md`); the IdP itself — BR-39; app residence (D8), canvas runtime
(ARCH-16, not a Diag prerequisite per D9).

**Ratified decisions respected, not relitigated**: D3=A (guest rows in `users` with explicit status +
TTL), D4 (dual-phase anonymous-first then IdP opt-in), D8 (diag stays in the monorepo), D9 (documents +
S3 first; comments only after the `contextType` enum gains `canvas|artifact`).

Owner decisions ratified 2026-07-25 that bind this study: diag phase 1 is **invite-gated**; guest TTL
**30 days**; controller **Sent-Tech**; diag workspaces **pooled into the `'sentropic'` tenant** — the
owner accepted the stated hazard that anonymous cost and authz blast radius mix into production
(`api/src/db/schema.ts:22` default; `spec/SPEC_EVOL_QUOTA_LEDGER.md:21`). `TENANT_RESOLUTION_MODE` must
be at least `shadow` before diag traffic starts (`api/src/services/tenancy/resolve-tenant.ts:143-187`).

## 2. Decisions

**A1 — The guest principal is encoded on the LIFECYCLE axis, never on `role`. (CRITICAL)**
`users.role` DEFAULTS to `'guest'` (`api/src/db/schema.ts:150`) and `'guest'` ALREADY denotes a
*downgraded registered human*: `approval_expired_readonly` and expired `pending_admin_approval` both
coerce `role='guest'` (`api/src/routes/auth/login.ts:83-84`,
`api/src/services/session-manager.ts:219-223`, `api/src/routes/auth/oauth.ts:137-139`). A naive D3 guest
insert would therefore be **indistinguishable from a suspended real user** and would inherit `guest`
RBAC (`api/src/middleware/rbac.ts:18`) — a silent authz conflation.
**Position:** a new `users.account_status = 'guest_anonymous'` value + a new `users.guest_expires_at`
column. `account_status` is already the lifecycle/disable axis and already the first thing login checks
(`api/src/routes/auth/login.ts:66`; values at `api/src/routes/api/admin.ts:163,204,261`).
`users.email` is nullable + unique (`schema.ts:148`) so guest rows need no synthetic email.

**A2 — The guest gets its OWN cookie, distinctly named, never the `session` cookie.**
Payload = signed `{gid, appInstanceId, iat}`, HMAC'd server-side, opaque to the browser; `__Host-`
prefixed. The existing session cookie is already `HttpOnly; Secure(prod); SameSite=Lax; Path=/` with NO
`Domain` (`api/src/services/auth/session-adapter.ts:46-48`) — i.e. already host-only, satisfying
`spec/SPEC_EVOL_ARCHITECTURE.md:231`. Reusing it would route the guest through
`validateSessionToken` (`api/src/middleware/auth.ts:66-73`) and require a fake `user_sessions` row.

**A3 — `requireAuth` NEVER downgrades to a guest.**
It stays byte-identical (401 on missing/invalid, `api/src/middleware/auth.ts:60-73`). The guest principal
is resolved by a SEPARATE `resolveAppPrincipal` middleware mounted only under the app route family.
This implements `spec/SPEC_EVOL_ARCHITECTURE.md:261` ("invalid auth tokens fail instead of silently
becoming guest sessions") and leaves the console plane untouched.

**A4 — CSRF = `SameSite=Lax` + a MANDATORY fail-closed `Origin`/`Sec-Fetch-Site` check** against the
resolved `Host` (the same host-authoritative check that 404s on slug mismatch,
`spec/SPEC_EVOL_ARCHITECTURE.md:229-230`). A double-submit token only if an embed/iframe mode is ever
requested: with a host-only cookie, a same-origin API and `Lax`, it adds ceremony without a threat.
Precedent in-repo: `SameSite=None` is used ONLY for cross-site POST callback providers
(`api/src/routes/auth/federation.ts:210-218,314-320`).

**A5 — The Diag API MUST be same-origin. HARD constraint, not a preference.**
The PUBLISHED default transport passes NO `credentials` on `fetch`
(`packages/chat-ui/src/client/transport.ts:163-171,173-180`) and constructs `new EventSource(target)`
with NO `withCredentials` (`transport.ts:159`). A cross-origin API host therefore **silently drops the
guest cookie on both the POST and the SSE leg, with no error**, and would additionally make the guest
cookie third-party (`spec/SPEC_EVOL_ARCHITECTURE.md:231-232`).
*Recorded discrepancy:* the separate `streamHub` path DOES set `withCredentials:true`
(`packages/chat-ui/src/client/streamHub.ts:366-370`). **The codebase contradicts itself — do not
generalise from streamHub.** Same-origin is mandatory either way; this is the mechanical proof of the
host-authoritative default at `spec/SPEC_EVOL_ARCHITECTURE.md:227-230`.

**A6 — The "app-safe chat DTO" is a MOUNT CONFIGURATION, and the capability gate is ALREADY SHIPPED.**
`@sentropic/chat-server@0.3.0` carries a deny-capable gate over exactly the privileged knobs
`spec/SPEC_EVOL_ARCHITECTURE.md:83-86` names — `acceptClientProviderApiKey`,
`acceptClientLocalToolDefinitions`, `acceptClientVscodeAgent`, `allowedTools`, `allowedLocalTools`, plus
mount-DECLARED `localToolDefinitions` (`packages/chat-server/src/index.ts:76-102,112-137`), applied in
`postMessage` (`:653-668`). `render_mermaid` is the documented worked example (`:96-97,126-134`).
**Defaults are PERMISSIVE, not safe** (`:36-63`) — a public mount must set them explicitly:
`{acceptClientProviderApiKey:false, acceptClientLocalToolDefinitions:false, acceptClientVscodeAgent:false,
allowedTools:[], allowedLocalTools:['render_mermaid']}` + `localToolDefinitions:[renderMermaidDef]`.
**Residual ARCH-02 work, and it is small:** (a) `contexts` / `primaryContextType` / `primaryContextId` /
`sessionTitle` / `attachments` pass through UNGATED (`:672-684`) and must be validated against the
guest's OWN workspace; (b) an attachment size/count cap. The response side needs no narrowing
(`ChatServerMessage`, `:148-158`, carries no principal data).

**A7 — The public mount supplies an explicit `getUser`; the `anonymous` fallback is never relied upon.**
The package default `user ?? {userId:'anonymous', workspaceId:null}`
(`packages/chat-server/src/index.ts:551-552`) is a dev/harness convenience. ARCH-02 does not need it
removed (that would be breaking under D11) but MUST NOT depend on it — satisfying
`spec/SPEC_EVOL_ARCHITECTURE.md:252-253` with zero package surgery. Optional additive follow-up for the
chat lane: a `requireUser:true` option that 401s instead of falling through.

**A8 — Factory extraction is scoped to `documents` ONLY.**
Chat is ALREADY a host-parameterized factory (`createChatServer(deps.getUser)`,
`api/src/routes/api/chat.ts:369-371`), so the public app needs a SECOND MOUNT, not an extraction. What
actually blocks reuse is the route-group `requireAuth` at the mount site, not the router shape:
`api/src/routes/api/index.ts:158` (`/chat/*`), `:162` (`/documents/*`), `:170` (`/comments/*`),
`:118` (`/workspaces/*`).
**Drop `workspaces` from ARCH-02 entirely** — a public app must never expose the console workspace API
(`spec/SPEC_EVOL_ARCHITECTURE.md:237`). **`comments` is phase 2**, blocked behind the `contextType` enum
extension to `canvas|artifact` (`spec/SPEC_EVOL_ARCHITECTURE.md:497-499`; live enums at
`api/src/routes/api/documents.ts:23` and `api/src/routes/api/comments.ts:20`) — anonymous commenting is
not a phase-1 requirement (`:490-491`).

**A9 — Claiming a guest workspace = a membership row plus a soft field.**
`workspaces.owner_user_id` is a plain `text` column with **NO foreign key and NO cascade**
(`api/src/db/schema.ts:15`); the authoritative ownership edge is
`workspace_memberships(workspace_id,user_id,role)` with `UNIQUE(workspace_id,user_id)` (`:844-854`).
Claim = `INSERT ... ON CONFLICT (workspace_id,user_id) DO UPDATE role` + `UPDATE workspaces SET
owner_user_id`. Deleting the guest row cascades the guest's own membership away but does not touch the
workspace — so `spec/SPEC_EVOL_ARCHITECTURE.md:281` ("claim moves ownership without changing artifact
ids") is mechanically true here.

**A10 — Claim token: single-use, double-bound, consumed in the merge transaction.**
Signed, `ttl ≤ 600s` (aligned to the OAuth continuation default,
`packages/auth-hono/src/oauth/authorize-handler.ts:227`), claims
`{jti, gid, ws:[workspaceIds], aud: <app origin>, cnf: sha256(guestCookieValue)}`. Double binding — to
the app ORIGIN and to the LIVE guest cookie — means a leaked or shared claim link cannot be redeemed
from another browser. `jti` is recorded and consumed **in the same transaction as the merge**, so replay
is a no-op rather than a second merge. The OIDC authorization code being single-use does NOT make the
product claim token single-use.

**A11 — Merge policy: one transaction, artifact plane only, identity plane never.**
Idempotent on `(guestUserId, targetUserId)`; `pg_advisory_xact_lock` on both user ids in sorted order.
Steps: (1) re-key the ARTIFACT plane (§3A); (2) `ON CONFLICT DO NOTHING` + drop-the-guest-row on the six
UNIQUE-collision sites; (3) NEVER re-key the identity/session plane (§3B); (4) DELETE the guest `users`
row LAST, so cascade cleanup happens only after authorship transfer
(`spec/SPEC_EVOL_ARCHITECTURE.md:286-287`). Failure modes covered: partial merge (single tx),
double-claim (advisory lock + `jti`), replay (`jti` consumed in-tx), concurrent claim of the same guest
by two accounts (lock ordering; the guest row is gone after the first).

**A12 — TTL mechanism here, duration and erasure basis in ARCH-15.**
ARCH-02 owns `guest_expires_at` + a reaper that deletes the `users` row and lets cascade clean up
(`spec/SPEC_EVOL_ARCHITECTURE.md:288-289`). The DURATION (30d, ratified) and the lawful-basis/erasure
story belong to BR-56 (`spec/SPEC_EVOL_DATA_LIFECYCLE.md`). Do not design retention here.

**A13 — ARCH-02 does not own the anonymous quota; it EMITS the principal.**
ARCH-13 is complete and declares it "Unblocks ARCH-02 (anonymous quotas)"
(`spec/SPEC_EVOL_QUOTA_LEDGER.md:53`). ARCH-02 consumes `principal_kind='guest'|'anonymous'` +
`principal_key` (`:20`) and the `anonymous_pool` scope (`:21,39`). Its only obligation is to emit a
correct `CostContext`.

## 3. Guest→account merge: verified FK inventory

Read from `api/src/db/schema.ts`. All FKs target `users.id`.

**§3A — ARTIFACT / AUTHORSHIP plane — MUST be re-keyed guest→account**
`chat_sessions.user_id` NOT NULL CASCADE (`:619-621`, the load-bearing one; `chat_messages` has no user
FK and follows the session, `:637-641`) · `chat_message_feedback.user_id` (`:699-701`) ⚠UNIQUE `:708` ·
`chat_generation_traces.user_id` (`:721-723`) · `comments.created_by` NOT NULL CASCADE (`:938-940`),
`comments.assigned_to` SET NULL (`:941`) · `workspace_memberships.user_id` (`:848-850`) ⚠UNIQUE `:854` ·
`object_locks.locked_by_user_id` (`:912-914`), `.unlock_requested_by_user_id` (`:918`) ⚠UNIQUE `:922` ·
`extension_tool_permissions.user_id` (`:962-964`) ⚠UNIQUE `:976` ·
`document_connector_accounts.user_id` (`:466-468`) ⚠UNIQUE `:482` ·
`llm_provider_accounts.owner_user_id` (`:496`) ⚠UNIQUE `:517` · `llm_account_leases.user_id` (`:537`) ·
`plans` (`:989-990`), `todos` (`:1008-1009`), `tasks` (`:1038-1039`), `agent_definitions` (`:1103`),
`workflow_definitions` (`:1131`), `guardrails` (`:1205`), `execution_runs.started_by_user_id` (`:1247`) ·
`tenant_memberships.user_id` (`:885-887`) ⚠UNIQUE `:896`, `.approved_by_user_id` (`:890`) ·
`users.approved_by_user_id` self-FK (`:155,162-165`).

**⚠ SIX UNIQUE-collision sites** — a blind `UPDATE ... SET user_id=:account` raises 23505 on every one
and is **the single most likely partial-merge bug**. Use `ON CONFLICT DO NOTHING` + drop-the-guest-row:
`workspace_memberships` (`:854`), `tenant_memberships` (`:896`), `chat_message_feedback` (`:708`),
`extension_tool_permissions` (`:976`), `document_connector_accounts` (`:482`),
`llm_provider_accounts` (`:517`).

**§3B — IDENTITY / SESSION plane — MUST NOT be re-keyed; dies with the guest row**
`webauthn_credentials` (`:173-175`) · `user_sessions` (`:187-189`) · `webauthn_challenges` (`:207`) ·
`magic_links` (`:221`) · `identities` (`:268-270`) · `auth_invite_tokens.consumed_by_user_id` (`:254`) ·
`oauth_clients.owner_user_id` (`:321`) · `authorization_codes` (`:335-337`) · `oauth_tokens` (`:362-364`) ·
`oauth_consents` (`:386-388`) · `revoked_tokens` (`:416`).
Re-keying any of these would GRAFT a guest's credentials/consents onto a real account — **the
highest-severity failure mode in the whole merge**.

**§3C — SOFT / non-FK, still needs an UPDATE**
`workspaces.owner_user_id` — plain `text`, no FK, no cascade (`:15`). Nothing enforces it, so a
forgotten UPDATE leaves a dangling guest id forever with **no referential error**.

**§3D — NO re-key needed (material simplification for D9)**
`context_documents` has **NO user column at all** — only `workspace_id` / `context_type` / `context_id` /
`storage_key` (`:764-796`), likewise `context_document_versions` (`:799-813`). Since D9 scopes Diag
phase-1 persistence to **documents + S3** (`spec/SPEC_EVOL_ARCHITECTURE.md:497`), **the entire phase-1
artifact plane carries ZERO user FKs and requires ZERO merge work.** The merge engine is needed only
once chat sessions and comments become claimable — i.e. phase 2.

## 4. Minimum gate-clearing set for BR-62 phase 1

Seven items. Everything else in ARCH-02 is phase 2.

- **M1 — Guest principal row**: `account_status='guest_anonymous'` + `guest_expires_at` (A1) + one guest
  `workspace` + one `workspace_memberships` row (A9). One migration. Justified: `chat_sessions.user_id`
  is NOT NULL FK to `users` (`schema.ts:619-621`) — without a real row there is no chat at all.
- **M2 — Guest cookie + `resolveAppPrincipal` middleware** under `/api/apps/:appSlug/*`,
  host-authoritative with 404 on slug/Host mismatch (A2/A3/A4). `requireAuth` and all `/api/v1/*`
  console mounts UNCHANGED.
- **M3 — A SECOND, capability-gated chat mount** (A6/A7) — not an extraction.
- **M4 — Same-origin serving of the Diag API** (A5).
- **M5 — `documents` factory extraction ONLY** (A8), guest-scoped to the guest workspace.
- **M6 — `CostContext` emission** with `principal_kind='guest'` + `principal_key` (A13).
- **M7 — Guest TTL reaper** wired to `guest_expires_at` (A12), with the authorship-transfer-before-delete
  ordering of A11 step 4. Phase 1 needs the reaper because unclaimed guest rows accumulate from day one;
  it does NOT need the merge path.

**Explicitly PHASE 2, not gates on going public**: the claim token (A10), the merge/FK-re-key engine
(A11, §3), the RP session glue, the Diag `oauth_clients` row, passkey rpID bootstrap, and the
comments/`contextType` extension.

## 5. Co-gates that still hold BR-62 (M1-M7 must NOT be read as "unblocked")

1. **XFF / trusted proxy — VERIFIED UNMET.** `ui/nginx/default.conf` forwards `Upgrade`, `Connection`
   and `Host` but **NOT `X-Forwarded-For`**, and `api/src/app.ts` has no trusted-proxy configuration.
   `spec/SPEC_EVOL_QUOTA_LEDGER.md:11,42` names this a prerequisite: without preserved client IP, ALL
   anonymous traffic collapses into one bucket and a single actor drains the pool. Cross-repo (the
   poc-k8s LoadBalancer must also preserve client IP). Owner-assigned to a dedicated `fix/*` branch.
2. **BR-56 / ARCH-15 retention** (`spec/SPEC_EVOL_DATA_LIFECYCLE.md`, `PLAN.md:646`), whose G3 item —
   one working erasure primitive reaching PG and S3 — has real build content, and which names two live
   schema defects that block it: `comments.created_by` `ON DELETE CASCADE` (`schema.ts:938-940`) and
   `context_documents.workspace_id` with NO `onDelete` (`:766-769`, so a workspace delete is FK-BLOCKED).

## 6. Evaluator divergences (recorded, not averaged)

- **SSE credentials.** Codex cited `streamHub.ts:366-370` (`withCredentials:true`) and concluded the
  published transport carries credentials. Opus checked BOTH paths and found the PUBLISHED default
  disagrees (`transport.ts:159,163-171`, no credentials). **Opus adopted** — it is the more precise
  reading, and it makes A5 a mechanical constraint rather than a preference. Net conclusion identical.
- **Factory extraction scope.** Codex said workspaces + documents + comments. Opus showed chat is
  already a factory and that the blocker is the route-group `requireAuth`, narrowing the work to
  `documents` only and excluding `workspaces` on principle. **Opus adopted** — better grounded and
  strictly smaller.
- **Guest status encoding.** Only Opus found the `role='guest'` collision (A1). Adopted; it is the
  highest-severity finding in this study.
- Everything else converged, including the headline (strike BR-39n), the claim-token single-use
  requirement, the identity-plane no-re-key rule, and the permissive chat-server defaults.

## 7. Open questions

1. **OWNER / ARCH-01** — diag tenant identity. Ratified 2026-07-25 as POOLED into `'sentropic'` with the
   hazard accepted; recorded here because it should be revisited the day diag opens to the internet.
   `TENANT_RESOLUTION_MODE` must be at least `shadow` before diag traffic starts.
2. **OWNER (D6 rider, `PLAN.md:661`)** — the anonymous spend cap number for the diag surface. The
   per-tenant strategy is resolved in ARCH-13 (`spec/SPEC_EVOL_QUOTA_LEDGER.md:63-72`); the NUMBER is an
   owner input before public exposure. Less pressing under the invite-gated posture.
3. **OWNER** — merge boundary for non-artifact rows. Recommended: transfer claimable
   workspace/artifact/authorship only; revoke credentials, OAuth state, provider accounts, active
   leases, locks and extension permissions.
4. **CHAT LANE** — is an additive `requireUser:true` option on `createChatServer` wanted (A7), or does
   ARCH-02 simply never rely on the fallback? Reversible either way; the mount-side answer needs no
   coordination.
5. **CROSS-REPO / poc-k8s** — does the SCW LoadBalancer preserve client IP (§5.1)? Unverifiable from this
   repo, and unenforceable anonymous quota if the answer is no.
