# SPEC STUDY — BR-39 auth/IdP ecosystem vs MCP authorization, mcp-authkit & elicitation: gap analysis

Status: STUDY (planning-only, 2026-06-11). No code. Baseline = `main` working tree.
Mission: for each dimension, (a) what we HAVE, (b) the GAP, (c) RECOMMENDATION (owning BR-39* or new sub-branch + decisions to settle).

External sources (fetched 2026-06-11):
- mcp-authkit: `https://github.com/masterela/mcp-authkit` (README; Python/FastMCP pluggable auth lib).
- MCP elicitation draft: `https://modelcontextprotocol.io/specification/draft/client/elicitation` (form + URL modes, 2025-11-25 URL-mode addition).
- MCP authorization draft: `https://modelcontextprotocol.io/specification/draft/basic/authorization` (OAuth 2.1 + RFC 9728 PRM + RFC 8707 + CIMD + RFC 9207).

Internal sources (read): `packages/auth-hono/src/**` (ports.ts, oauth/{token,authorize,wellknown,service-auth-middleware,state-store-types}), `spec/SPEC_EVOL_AUTH_39E_MULTITENANT.md`, `spec/SPEC_EVOL_AUTH_IDP_STANDALONE.md`, `spec/SPEC_EVOL_RESOURCE_FS.md`, `spec/SPEC_EVOL_ARCHITECTURE.md` (ARCH-08/11/21 excerpts), `b2b2b-sentropic-eval.md`, `~/.claude/.../memory/project_br39_full_roadmap.md`, `api/src/services/catalog/sources/mcp-source.ts` (via RF-spec evidence).

Seam constraint honored throughout (roadmap "3 durable seams", seam #1): **Sentropic auth owns identity + credential + scope ONLY; trust/engagement/MANDATE/BINDING/CONFIANCE live in h2a**. Every recommendation below bridges via a token claim referencing an h2a engagement — never by moving trust semantics into the IdP.

---

## 0. Implemented baseline (verified in code, not roadmap)

What `@sentropic/auth-hono` actually ships on `main` (0.5.0):

| Capability | Evidence |
|---|---|
| OAuth2 `authorization_code` + PKCE S256 (per-client `requirePkce`) | `oauth/token-handler.ts:58` (verifier check), `state-store-types.ts:16` |
| `client_credentials` (stateless service tokens, BR39d-D5) | `token-handler.ts:151-303` |
| DPoP (RFC 9449), opt-in per client, `cnf.jkt`, replay-jti store; `ath`-bound on RS middleware | `oauth/dpop.ts`, `token-handler.ts:120-149`, `service-auth-middleware.ts` (BR39d-D7) |
| RFC 8707 resource indicators — **client_credentials grant ONLY**, per-client allowlist | `token-handler.ts:216-238` (`resolveResourceIndicator`), `ServiceClientRecord.resourceIndicators` |
| RS verification middleware (issuer + audience = resource) on a narrow port | `service-auth-middleware.ts:105-126` |
| Introspection (RFC 7662) + revocation | `oauth/introspect-handler.ts`, `oauth/revoke-handler.ts` |
| OIDC discovery + JWKS (Ed25519/EdDSA only) | `oauth/wellknown-handler.ts:17-42` |
| `acr`/`auth_time`, `prompt=none|login` | `authorize-handler.ts:39-56`, `token-handler.ts:334` |
| Tenancy spine (BR-39e, merged PR #283): `tenants` + `tenant_memberships`, `tid` claim derived from VALIDATED `approved` membership, re-validated at token time, lifecycle gates | `ports.ts:296-301` (`AuthHonoTenantPort`), `token-handler.ts:320-327`, `wellknown-handler.ts:20` (`tid` in `claims_supported`) |
| Tenant-scoped client governance (`oauth_clients.tenant_id`, `listTenantClients`) | BR-39e Lot 4 (roadmap memory, PR #283) |
| Live IdP `auth.sent-tech.ca` (JWKS + discovery 200) | roadmap memory, go-live 2026-06-06 |

Hard facts that drive most gaps below:

1. **The user-flow access token audience is HARDCODED to the userinfo endpoint**: `token-handler.ts:331` — `accessAudience = ${issuer}/api/v1/auth/oauth/userinfo`. The `resource` parameter is not read on the `authorization_code` path (neither in `authorize-handler.ts` nor in the code-grant branch of `token-handler.ts`). A user-delegated token can therefore **never be audience-bound to an MCP server**, which the MCP spec makes mandatory ("MCP servers MUST validate that access tokens were issued specifically for them as the intended audience, according to RFC 8707 Section 2").
2. **No RFC 9728 Protected Resource Metadata anywhere** (`grep -ri "9728|protected.resource|oauth-protected-resource" packages/auth-hono/src api/src` → zero hits). MCP draft: "MCP servers **MUST** implement OAuth 2.0 Protected Resource Metadata (RFC9728). MCP clients **MUST** use [it] for authorization server discovery."
3. **No RFC 7591 DCR and no Client ID Metadata Documents** (`grep "7591|dynamic.client|/register"` → only WebAuthn `/register/*` in `contracts.ts`). Registration today = seed file (`api/src/services/auth/oauth-client-seed.ts`) or psql INSERT in prod (roadmap memory, go-live notes).
4. **No RFC 8693 token exchange** (`grep "8693|token.exchange"` → only a prose comment at `token-handler.ts:321`). 39i is roadmap-only; the openerp brokered lane is the deferred 39e Lot 5.
5. **No refresh tokens on the OAuth flow** (token response in `token-handler.ts:365-370` has no `refresh_token`; `SPEC_EVOL_AUTH_IDP_STANDALONE.md` R10 explicitly rejects `offline_access`, choosing `prompt=none` silent renew — a browser-cookie mechanism that desktop/headless MCP clients do not have).
6. **No RFC 9207 `iss` authorization-response parameter** (absent from `authorize-handler.ts` redirects and from discovery metadata) and **no `/.well-known/oauth-authorization-server` (RFC 8414) alias** — only `openid-configuration` (`wellknown-handler.ts:17`). The MCP draft accepts OIDC discovery alone ("at least one of"), but requires clients to try both; serving the RFC 8414 path is a cheap interop win.
7. **No `WWW-Authenticate` challenge semantics on the RS side**: `service-auth-middleware.ts` returns JSON errors but does not emit `WWW-Authenticate: Bearer resource_metadata=..., scope=...` (401) or `error="insufficient_scope"` (403) as the MCP scope-selection/step-up flow expects.
8. **Scope model is flat and tiny**: `scopes_supported: ['openid','profile','email']` (`wellknown-handler.ts:30`); service scopes are free-form strings against a per-client allowlist (`token-handler.ts:199-214`). No tool/resource-grained grammar.

---

## 1. Enterprise tenant management

**HAVE (BR-39e, merged PR #283 + spec `SPEC_EVOL_AUTH_39E_MULTITENANT.md`):** tenant registry (`tenants` with lifecycle status active/suspended/offboarded), per-(user,tenant) `tenant_memberships` (invited/requested/approved/rejected/suspended, tenant-scoped `admin` role), tenant-scoped acceptance with anti-enumeration + pending caps, immutable `tid` claim derived only from validated membership and re-checked at token time (`token-handler.ts:320-327`), tenant↔client association + `listTenantClients` governance, negative A→B isolation tests. D4: acceptance verdict = minimal auth-admin in v1; trust semantics migrate to h2a later.

**GAP:**
- **Tenant-scoped policy is membership-only.** There is no per-tenant *client policy* surface: allowed grant types, scope ceilings, redirect/CORS governance per tenant ("redirect/CORS governance per tenant" was named in 39e Lot 4 scope but only the association + list landed), token TTL/DPoP requirements per tenant, per-tenant signing-key isolation. Enterprise IdPs key all of these per tenant.
- **No tenant-admin UI/API beyond membership decide + client list** (39g "Admin UI for OAuth clients / service clients / tenants / branding" is still optional/unstarted, roadmap memory line 23).
- **Service clients have `tenantId` but service tokens carry no `tid`** (`issueServiceToken`, `token-handler.ts:280-294`: claims = `client_id`, `cnf`, `scope` only). A multi-tenant resource server cannot segregate S2S callers by tenant from the token.
- **Multi-membership selection screen** deferred (39e follow-up d): `?tenant=` param works, account-chooser UI missing.
- **Three tenant meanings still unreconciled app-side** (ARCH-11, `SPEC_EVOL_ARCHITECTURE.md` study table: "Unify the three tenant meanings; `tenant_memberships` seam with BR-39e").

**RECOMMENDATION:** owner = **BR-39g (promote from optional)** for the tenant-admin policy/console surface; **BR-39h** for `tid` on service/NHI tokens (it touches the identity unification anyway). Decisions to settle: (i) per-tenant client-policy schema (scope ceilings, grant allowlist, DPoP-required flag) — additive columns on `oauth_clients`/`service_clients` vs a `tenant_client_policies` table; (ii) whether per-tenant JWKS isolation is ever needed (recommend NO for v1 — single issuer, `tid` claim is the partition; per-tenant issuers would force per-tenant discovery and break the single-IdP model).

---

## 2. Registry of INTERNAL MCPs (per-tenant MCP catalog)

**HAVE:**
- `McpCatalogSource` (`api/src/services/catalog/sources/mcp-source.ts`): connects → `listTools()` → maps tools → closes; `callTool()` opens a fresh connection per call. Evidence catalogued in `SPEC_EVOL_RESOURCE_FS.md` §2: tools only (no `resources/list`/`read`/`subscribe`), tool ids re-derived each refresh with order-dependent collision suffixes — **not refresh-stable**.
- Resource Plane target (`SPEC_EVOL_RESOURCE_FS.md` §3.1-3.2, ARCH-21a/BR-70): `ResourceRef{provider:'mcp:<server>'}`, mount tree `/mcp/<server>/tools|resources`, **authz-projected namespace with deny-as-missing**, MCP resource uris kept verbatim as ids. RF spec also records: `CompositeCatalogRegistry.list/search` are UNSCOPED and `search_catalog` has no authz; `StandaloneToolHandler` and MCP `callTool` carry **neither idempotency key nor actor chain** (§3.4).
- 39l (roadmap): one manually-seeded MCP connector client (`h2a-gateway`, registered in prod via psql).

**GAP:**
- **No registry at all in the auth/control plane**: no `mcp_servers` table, no per-tenant MCP catalog, no registration flow, no server identity (an MCP server is not an identity type — 39h's `mcp_connector` is roadmap-only), no attestation at registration, no linkage between a catalog MCP source and an OAuth/service client.
- **No mount authorization**: who may mount which MCP into which tenant/workspace is undecided; today the catalog source list is config, not tenant data, and listing is unscoped.
- **No discovery scoping**: the MCP draft's PRM-based discovery assumes each MCP server publishes its own metadata; an *internal* registry needs the inverse — the platform catalog telling principals which servers exist *for their tenant* and with which scopes.
- **No credential custody model** for the connector: when the platform mounts an internal MCP, what credential does `callTool` present? Today: nothing (no actor chain at the invoke seam).

**RECOMMENDATION:** **new sub-branch 39m-mcp-registry** (control-plane data + auth linkage), co-designed with Resource Plane BR-70 (which owns the projection/mount UX) — registry rows = `(tenant_id, server_url, prm_url, client_binding{oauth_client|service_client|mcp_connector-NHI}, allowed_scopes, mount_policy, attestation_ref)`. Decisions: (i) registry residence — control-plane DB (ARCH-01 app model) vs IdP DB (recommend control-plane, IdP only holds the *identity* of the connector, seam #1); (ii) id stability contract (RF1 prerequisite — fix `McpCatalogSource` id derivation first); (iii) mount authz = catalog-kind scopes (`discover/read/invoke` per RF §3.2) vs OAuth scopes (recommend: OAuth scopes for *token* issuance, catalog authz for *projection* — two layers, don't conflate).

---

## 3. Multi-tenant MCP servers (one MCP serving many tenants)

**HAVE:** the ingredients exist separately — `tid` claim on user tokens (39e Lot 3), audience binding on service tokens via RFC 8707 (39d), `createRequireServiceAuth` verifying `iss`+`aud` (`service-auth-middleware.ts:126`), per-tenant lifecycle gates at token time.

**GAP:**
- **User tokens cannot reach an MCP server at all** (audience hardcoded to userinfo, §0.1) — so the tenant-isolation question for user-delegated MCP access is moot until RFC 8707 lands on the code flow.
- **Service tokens carry no `tid`** (§1) — an MCP server holding a service token knows *which client* but not *which tenant* it acts for; data segregation has to be smuggled into scope strings.
- **The RS middleware checks audience but not tenant**: `verifyAccessToken` (`service-auth-middleware.ts:105-126`) validates `issuer` + `audience`; there is no `requireTenant`/`tid` assertion hook for a multi-tenant resource server, and no canonical guidance (per-tenant resource URIs `https://mcp.x/t/<tid>` vs single resource + `tid` claim).
- **No per-tenant scope ceilings at the AS** when one MCP server (one resource) serves many tenants: a client allowed `resource=https://mcp.x` gets whatever its allowlist says, with no tenant cross-check between the client's tenant and the resource's tenant rows.

**RECOMMENDATION:** owner = **39l-mcp-authz** (the audience/resource work, §5) + **39h** (tid on non-user tokens). Decisions: (i) **isolation unit** — single canonical resource URI + mandatory `tid` claim validated by the RS (recommended: matches RFC 8707 "most specific URI" guidance without exploding the resource registry) vs per-tenant resource URIs (stronger audience isolation, heavier registry; reserve for hostile-tenant cases); (ii) extend `createRequireServiceAuth` with an optional `requireTenant: (tid) => boolean` hook so RS-side segregation is a library guarantee, not app folklore; (iii) negative A→B tests at the MCP layer mirroring the 39e invariant ("every tenant-scoped query is tenant-filtered", `SPEC_EVOL_AUTH_39E_MULTITENANT.md` §7).

---

## 4. B2B / B2B2B (org↔org) vs the e2h2a model

**HAVE:**
- Decided architecture (39e D2, owner-confirmed): **brokered federation, not OIDC Federation 1.0** — "openerp = trusted external issuer + RFC8693 token-exchange (brokered), in a separate lane" (`SPEC_EVOL_AUTH_39E_MULTITENANT.md` D2); `(iss,sub)` composite reserved for external issuers (§7). openerp already ships its side (`POST /auth/exchange-agent-token`, RFC8693, scope-intersected, ttl-capped — §4 consumer inputs).
- The trust model itself lives in h2a: `b2b2b-sentropic-eval.md` models org A (sentropic) → org B (immo) → org C (AgenceX) as `e2h2a` units linked by ENGAGEMENTs with MANDATE+BINDING for agents, disclosure modes for opaque boundaries — and states this instantiates **today on frozen h2a** (§Compatibility hypothesis).
- Roadmap seam #2: "B2B2B orgs are independent, linked by service contract, NOT nested tenant rows. `tenant_id` is only the within-IdP hook."

**GAP:**
- **The IdP-side broker does not exist**: no trusted-issuer registry, no RFC 8693 endpoint, no `(iss,sub)` mapping store — all deferred to `feat/auth-39e-openerp-broker` (39e follow-up b).
- **Cross-org MCP access is unspecified**: when org C's agent calls an MCP server owned by org A, the token chain (C-issuer token → exchange at A's IdP → A-audience token with `act` chain) is exactly RFC 8693 brokering, but nothing defines *which engagement authorizes the exchange*. The bridge claim (`act` referencing an h2a ENGAGEMENT id) is named in the roadmap (seam #1) but has no schema.
- **No inbound-trust policy object**: which external issuers a tenant trusts, with what scope intersection and TTL cap, is currently an openerp-side concept only; the platform IdP has no `trusted_issuers` table.

**RECOMMENDATION:** owner = **39i (RFC 8693 + act chains) merged with the 39e Lot-5 broker lane** — they are one mechanism; building them separately would duplicate the exchange endpoint. Decisions: (i) `act` claim payload shape — recommend `act: {sub, iss, h2a_eng: <engagement-ref>}` chain per RFC 8693 §4.1, where `h2a_eng` is an OPAQUE reference (the IdP never validates engagement semantics — h2a does; the IdP only checks the reference is present when policy requires it); (ii) trusted-issuer registry per tenant (issuer URL + JWKS + scope-intersection policy + TTL cap), mirroring what openerp built; (iii) exchange authorization policy: who may exchange what for what audience (recommend: subject-token tenant membership ∩ target resource tenant, plus DPoP-required for agent/NHI subjects per the 2026-05-31 decision #2).

---

## 5. MCP authorization (mcp-authkit patterns) mapped onto our IdP — the 39l gap

**What mcp-authkit does** (README, fetched): two-leg model. Leg 1: every MCP session gated behind a standard OIDC provider; `JwtAuthMiddleware` validates JWT bearer tokens (issuer + audience verification) and "publishes the RFC 8414 / MCP-spec well-known endpoints so the MCP client drives the PKCE flow automatically" (`oauth_meta_router`). Leg 2: tool-level third-party credentials — `OAuthProvider.require_token()` / `CredentialsProvider.require_credentials()` decorators collect credentials **on demand via MCP elicitation**, stored in pluggable backends (memory / Fernet-encrypted file / Redis), with per-request user context (`ContextVar current_user`).

**What the MCP authorization draft requires** (normative, fetched): AS MUST implement OAuth 2.1; MCP servers MUST implement RFC 9728 PRM and clients MUST use it for AS discovery; AS MUST provide RFC 8414 or OIDC discovery (clients MUST support both); AS+clients SHOULD support CIMD (DCR "deprecated, retained for backwards compatibility"); clients MUST send RFC 8707 `resource` on both authorize and token requests; MCP servers MUST validate audience per RFC 8707 and MUST NOT accept/transit other tokens (no passthrough); AS SHOULD emit RFC 9207 `iss` and clients MUST validate it; RS SHOULD emit `WWW-Authenticate` with `scope` + `resource_metadata` (401) and `insufficient_scope` (403) for step-up.

**HAVE / GAP per item (vs our code):**

| MCP-required item | Status in auth-hono / api | Gap owner |
|---|---|---|
| OAuth 2.1 code flow + PKCE | HAVE (39c) | — |
| RFC 9728 PRM (RS side) | **MISSING** (zero hits repo-wide) | 39l-mcp-authz |
| RFC 8414 `/.well-known/oauth-authorization-server` | **MISSING** (OIDC discovery only — spec-compliant minimum, but serve the alias) | 39l-mcp-authz |
| RFC 8707 `resource` on authorize+token (user flow) | **MISSING** — audience hardcoded to userinfo (`token-handler.ts:331`) | 39l-mcp-authz (the #1 blocker) |
| Audience validation helper for MCP RS | PARTIAL — `createRequireServiceAuth` checks `aud` but no PRM publishing, no `WWW-Authenticate` challenges | 39l-mcp-authz |
| CIMD (URL-as-client_id) | **MISSING** | 39l-dcr |
| RFC 7591 DCR | **MISSING** (39l roadmap names it; today = seed/psql) | 39l-dcr |
| RFC 9207 `iss` in authorization responses | **MISSING** | 39l-mcp-authz (small) |
| Refresh tokens for non-browser clients | **MISSING by decision** (R10 rejected `offline_access`; `prompt=none` needs a browser cookie MCP clients don't have) | 39l-mcp-authz (policy reversal, scoped to native/MCP clients) |
| Scope challenge / step-up (`insufficient_scope` + scope param) | **MISSING** on RS middleware; note our 39j ACR step-up is *authentication* step-up — MCP's is *scope* step-up; both needed, distinct | 39l-mcp-authz (+39j unchanged) |
| MCP-tool scope grammar | **MISSING** (`openid profile email` + free-form service scopes) | 39m-mcp-registry (grammar) + 39l (issuance) |
| Tool-level third-party credential vault (authkit Leg 2) | **MISSING** entirely (and per MCP elicitation spec the MCP *server* owns it — see §6) | 39q-elicitation-bridge |

**RECOMMENDATION:** **expand BR-39l into 39l-mcp-authz** — it is currently scoped as "connector glue, no new auth code needed" (roadmap line 21), which was true for claude.ai-as-client against our IdP-as-AS-for-userinfo, but is FALSE for the general case "our IdP authorizes access to MCP servers": that requires the resource-parameter/audience overhaul, PRM, and RS challenge semantics above. Key design decisions: (i) **audience model** — single `resource` → single `aud` per token (recommend; reject multi-audience tokens, they break least-privilege and the MCP passthrough prohibition); keep the userinfo audience as the *default* when no `resource` is supplied (backward-compatible with all existing RPs); (ii) **refresh-token policy** — issue rotating, DPoP-bound refresh tokens only to clients flagged `client_kind ∈ {native, mcp}` (reverses R10 narrowly; browser RPs keep `prompt=none`); (iii) **PRM as an auth-hono helper** (`createProtectedResourceMetadataRouter({resource, authorizationServers, scopesSupported})`) + `WWW-Authenticate` emission folded into `createRequireServiceAuth`, so every Sentropic MCP server gets MCP-spec compliance from the library (the mcp-authkit Leg-1 equivalent, in our stack).

---

## 6. MCP elicitation × auth/consent/identity — is there an auth gap mid-tool-call?

**What the draft says (fetched):** form mode MUST NOT carry secrets; URL mode is for sensitive interactions that must NOT pass through the MCP client; servers MUST bind elicitation requests to client AND user identity; servers MUST NOT rely on client-provided user identification — identity comes from MCP authorization (`sub`); the anti-phishing requirement: "the server MUST ensure that the user who started the elicitation request is the same user who completes the authorization flow" — canonically via a server "connect URL" that compares the browser session's subject to the elicitation initiator's `sub`; third-party tokens obtained via URL-mode OAuth are stored BY THE MCP SERVER, bound to user identity, and MUST NOT transit the client (token-passthrough prohibition).

**HAVE:** nothing elicitation-specific. Relevant adjacent assets: IdP session cookie + `session-resolver.ts` (could anchor the connect-URL identity check), `sub`/`tid` claims, consent screen (`<OAuthConsent/>`, 39c) for *OAuth scope* consent only, audit-log port (`AuthHonoAuditLogPort`). The chat ecosystem spec names the need ("per-call auth-context propagation; NHI token-delegation/scoping for chat-initiated tool calls", `SPEC_EVOL_CHAT_ECOSYSTEM.md` §security/NHI) but nothing is built.

**GAP — yes, there is a mid-tool-call auth gap, four-fold:**
1. **Elicitee identity verification (anti-phishing)**: a Sentropic MCP server doing URL-mode elicitation must verify session-`sub` == elicitation-initiator-`sub` at the connect URL. Our IdP can be that verifier (it owns the session cookie at `auth.sent-tech.ca`), but no primitive exists ("verify this browser belongs to sub X for elicitation E"). This is identity/credential work → squarely IdP-side per seam #1.
2. **Third-party credential custody**: the mcp-authkit Leg-2 / MCP external-authorization pattern requires the MCP *server* to store third-party tokens bound to `(iss, sub[, tid])`. We have no vault, no port, no encrypted-storage adapter. Per the MCP spec this belongs to the MCP server, NOT the IdP — so it is a *library* gap (an auth-client/auth-hono port), not an IdP endpoint.
3. **Consent + audit for elicited data**: elicitation acceptance is user consent happening OUTSIDE the OAuth consent screen, mid-tool-call. Nothing records it. Minimum: an audit event shape (`elicitation_id, sub, tid, server, mode, action ∈ accept|decline|cancel`) through the existing audit port; the ToolInteractionTrace decided in ARCH-21 (Resource Plane memory) is the natural carrier on the app side.
4. **NHI vs human elicitation**: an elicitation answered by an agent/NHI is not user consent. When the MCP session principal is an NHI acting under delegation, a human-targeted elicitation must either (a) be refused, (b) route to the delegating human (39k delegated-MFA-style policy: explicit consent + live user-presence + hard stops), or (c) satisfy a step-up (39j ACR). No policy exists; 39h identity types are a prerequisite to even express "the session principal is an NHI".

**RECOMMENDATION:** **new sub-branch 39q-elicitation-bridge** (small, after 39l-mcp-authz + 39h): (i) IdP connect-URL verification endpoint (`GET /oauth/elicitation/verify?eid=...` semantics: authenticated session required, returns/asserts sub-match — exact shape to co-design with a real MCP-server consumer, per the contract-consumer co-design rule); (ii) `ThirdPartyCredentialStorePort` in auth-hono/auth-client (memory + encrypted-PG adapters — the mcp-authkit storage-backend equivalent); (iii) elicitation audit event shape; (iv) NHI-elicitation policy table (deny / route-to-delegator / step-up), expressed against 39h identity types and 39k hard-stop semantics. Decision to settle: whether (i) lives on the IdP or each MCP server self-verifies via its own RP session — recommend IdP-assisted (single session authority, no per-server session sprawl), with the assertion returned as a short-lived signed JWT the MCP server validates against our JWKS.

---

## 7. NHI / agent identity & the h2a articulation (the seam)

**HAVE:**
- Roadmap decisions (2026-05-31, memory): 39h = unified `identities` table with `type ∈ {user, service, agent, nhi, mcp_connector}`, "bridge with `mcp__h2a__h2a_nhi_*` tools, attestation on register"; DPoP **mandatory** for `type ∈ {agent, nhi, mcp_connector}`; delegation TTL hard cap 24h.
- The seam, stated and re-stated: "sentropic auth owns identity+credential+scope ONLY; trust/engagement/MANDATE/BINDING/CONFIANCE stay in h2a... Bridge = token `act`/delegation claim referencing an h2a ENGAGEMENT, never duplicating it" (roadmap seam #1); "39h 'attestation on register' = credential/NHI-key attestation, NOT h2a comprehension-attestation"; AGENTS are non-signatory and act under MANDATE+BINDING (`b2b2b-sentropic-eval.md` mapping table); ARCH-08 anchors server-as-agent sends on MANDATE/BINDING with RFC 8693 delegation (`SPEC_EVOL_ARCHITECTURE.md` study table).
- h2a side: NHI tooling exists today (`mcp__h2a__h2a_nhi_attest/export/inventory/offboard/report` in this very environment's tool list).

**GAP (everything below the decisions):**
- **No identity types in code**: only `oauth_clients` + `service_clients`; no `identities` table, no `type` column, no enforcement point for "DPoP mandatory for agent/nhi/mcp_connector".
- **No `act` claim issuance** (39i unbuilt) and **no defined `act`↔h2a-engagement reference shape** — the single most important contract on this seam, still prose.
- **No attestation-on-register**: nothing verifies an NHI's key at registration, and nothing links a registered NHI client to its h2a NHI inventory entry (`h2a_nhi_export` output has no IdP-side consumer).
- **MCP-connector NHI acting for a tenant/user**: the composite "connector X, mandated by engagement E, acting for user U in tenant T" needs `sub`(connector) + `act`(U chain) + `tid` + engagement ref in ONE token; no token shape is specified.
- **Credential lifecycle for NHIs**: rotation exists for service clients (`make oauth-rotate-service-client`), but offboarding (h2a `nhi_offboard`) has no IdP hook (revoke all tokens + disable identity).

**RECOMMENDATION:** owner = **39h (identity unification, prerequisite) then 39i (the bridge)**, plus a thin **39-nhi-bridge** slice inside 39h: at NHI/agent/mcp_connector registration, require (a) key attestation (DPoP keypair proof-of-possession), (b) an OPAQUE `h2a_ref` (NHI inventory id / engagement ref) stored on the identity row — the IdP records it, never interprets it; offboarding webhook/manual path = revoke + disable keyed by `h2a_ref`. Decisions: (i) `act` chain canonical shape (§4 reco); (ii) whether `h2a_ref` is mandatory for `type ∈ {agent, nhi, mcp_connector}` (recommend YES — it is the operationalization of "AGENTS act under MANDATE", without the IdP judging the mandate); (iii) registration channel for NHIs: gated DCR (39l-dcr) with attestation vs admin-seeded only (recommend gated DCR — the h2a fleet is too dynamic for psql INSERTs, as the go-live detour proved).

---

## 8. "ALL MODELS" coverage matrix

Identity types × deployment modes. Legend: ✅ = covered by shipped primitive; 🟡 = partial (primitive exists, MCP-grade binding missing); ❌ = gap (owner in parentheses).

| | Single-tenant internal | Multi-tenant SaaS MCP | B2B brokered (org↔org) | Public |
|---|---|---|---|---|
| **human** | ✅ code+PKCE, `tid`, consent (39c/e) — 🟡 token cannot target an MCP server (aud hardcoded → 39l-mcp-authz) | 🟡 `tid` + lifecycle gates shipped; ❌ no RFC 8707 on user flow, no refresh tokens for MCP clients, no scope step-up (39l-mcp-authz) | ❌ no RFC 8693 broker, no trusted-issuer registry, no `(iss,sub)` store (39i+39e-Lot5) | ✅ public client + PKCE + `'none'` auth (design-system clients live in prod) |
| **service** | ✅ client_credentials + RFC 8707 + DPoP + `ath` RS middleware (39d) | 🟡 audience binding ✅; ❌ no `tid` on service tokens, no RS tenant assertion (39h + 39l-mcp-authz) | ❌ no cross-org service trust / exchange (39i) | ❌ no DCR/CIMD for third-party services (39l-dcr) |
| **agent** | ❌ no identity type; DPoP-mandatory decided, unenforced (39h) | ❌ + no per-tenant agent scoping (39h) | ❌ no `act` chain, no MANDATE bridge ref (39i + 39-nhi-bridge) | ❌ out of scope by design (agents are never public clients) |
| **nhi** | ❌ no identity type, no attestation-on-register, no h2a inventory link (39h + 39-nhi-bridge) | ❌ same + no `tid` (39h) | ❌ same + no engagement-ref claim (39i) | ❌ n/a |
| **mcp_connector** | 🟡 ONE hand-seeded confidential client (h2a-gateway, prod) — no type, no DCR, no PRM (39l) | ❌ no per-tenant connector registry, no MCP scope grammar (39m-mcp-registry) | ❌ cross-org MCP access undefined (39i) | ❌ claude.ai-style public connectors need DCR/CIMD + PRM (39l-dcr + 39l-mcp-authz) |

**Reading:** the **service × single-tenant** column is the only fully MCP-ready cell (39d did real RFC 8707 + DPoP work). The **human row** is one focused change away (resource param + refresh tokens). The **agent/nhi/mcp_connector rows** are roadmap-complete but code-empty — 39h is the bottleneck for the entire bottom half of the matrix.

---

## 9. Standards-alignment audit

| Standard | Status | Evidence / note |
|---|---|---|
| OAuth 2.1 (code+PKCE, no implicit/ROPC) | 🟡 PARTIAL | code flow + S256 ✅ (`token-handler.ts:58`); **no refresh tokens** (R10), no `iss` response param |
| RFC 7636 PKCE | ✅ | S256 only, per-client `requirePkce` |
| RFC 6750 Bearer | 🟡 | bearer accepted; **`WWW-Authenticate` challenge semantics missing** on RS |
| RFC 7662 Introspection | ✅ | `introspect-handler.ts` (user tokens; service tokens stateless by D5) |
| RFC 7591 DCR | ❌ | nowhere; 39l names it; MCP draft now marks it deprecated-but-compatible |
| CIMD (draft-ietf-oauth-client-id-metadata-document) | ❌ | not referenced anywhere in repo; MCP draft says AS/clients SHOULD |
| RFC 8414 AS metadata | 🟡 | OIDC discovery only (spec-sufficient since clients MUST try both; serve the alias anyway) |
| RFC 8693 Token Exchange | ❌ | comment-only (`token-handler.ts:321`); 39i + openerp lane |
| RFC 8707 Resource Indicators | 🟡 | client_credentials ✅ (`resolveResourceIndicator`); **authorization_code ❌** (aud hardcoded) |
| RFC 9207 `iss` param | ❌ | absent from authorize redirects + metadata |
| RFC 9449 DPoP | ✅ | opt-in per client, `cnf.jkt`, replay store, `ath` on RS (39d-D7); mandatory-for-NHI unenforced (needs 39h) |
| RFC 9728 Protected Resource Metadata | ❌ | zero hits repo-wide; MCP MUST for servers |
| OIDC Core (acr/auth_time/nonce/userinfo) | ✅ subset | EdDSA-only by design (decision #5) |
| OIDC Federation 1.0 | ➖ deliberately rejected | 39e D2 chose brokered token-exchange; do not resurrect |
| FIDO2/WebAuthn L2 | ✅ | core of 39a/b |
| MCP authorization (draft) | ❌ overall | blocked on 9728 + 8707-user-flow + challenges + registration |

---

## 10. Recommended new/expanded BR-39* lots (prioritized)

1. **39l-mcp-authz** (expand BR-39l; P1, unblocks the human row + every Sentropic MCP server) — RFC 8707 `resource` on authorize+token user flow with audience-bound tokens (default aud stays userinfo for legacy RPs); RFC 9728 PRM router helper + `WWW-Authenticate` (401 `resource_metadata`+`scope`, 403 `insufficient_scope`) in `createRequireServiceAuth`; RFC 8414 alias; RFC 9207 `iss`; rotating DPoP-bound refresh tokens for `client_kind ∈ {native,mcp}`. *Decisions:* audience model (single-aud, reject multi-aud), refresh-token policy reversal scope, default-aud backward compat.
2. **39h** (existing; P1, bottleneck for agent/nhi/mcp_connector rows) — unified `identities` with `type`; enforce DPoP-mandatory for NHI types; `tid` on service/NHI tokens; + **39-nhi-bridge slice**: key attestation at register + opaque `h2a_ref` (engagement/NHI-inventory pointer) stored-not-interpreted + offboard hook. *Decisions:* `h2a_ref` mandatory for NHI types; offboard channel (webhook vs manual).
3. **39l-dcr** (split of 39l; P2) — CIMD support + gated RFC 7591 DCR (tenant-admin-approved for confidential/NHI, open for public-PKCE within policy), replacing the psql-INSERT prod registration path (a named go-live follow-up). *Decisions:* registration gating policy per client kind; CIMD-first vs DCR-first.
4. **39i + 39e-Lot5 fusion** (existing ids; P2, B2B row) — single RFC 8693 exchange endpoint serving both the openerp brokered lane (trusted external issuers, `(iss,sub)`, scope-intersection, TTL caps) and the `act` delegation chain (`act:{sub,iss,h2a_eng}` opaque engagement ref). *Decisions:* `act` canonical shape; per-tenant trusted-issuer registry schema; exchange authorization policy.
5. **39m-mcp-registry** (new; P3, depends on 39h types + Resource Plane BR-70 co-design) — per-tenant internal MCP catalog: registration (links a catalog MCP source to an identity + PRM URL), stable ids (RF1 prerequisite), mount authz (deny-as-missing), MCP-tool scope grammar aligned with RF `discover/read/invoke`. *Decisions:* registry residence (control-plane DB, reco), scope grammar, OAuth-scopes-vs-catalog-authz layering.
6. **39q-elicitation-bridge** (new; P4, after 39l-mcp-authz + 39h) — IdP-assisted connect-URL identity verification for URL-mode elicitation (anti-phishing sub-match); `ThirdPartyCredentialStorePort` (mcp-authkit Leg-2 equivalent, MCP-server-local custody per spec); elicitation consent audit events; NHI-elicitation policy (deny / route-to-delegator via 39k semantics / 39j step-up). *Decisions:* IdP-assisted vs server-local verification (reco IdP-assisted, signed assertion); vault custody boundary (MCP server, never the IdP, never the client).

**Standing constraint on all lots:** the IdP never models VALEUR/ATTENTION/INTÉRÊT/CONFIANCE/MUTUALISATION, never stores MANDATE/BINDING content, never judges engagements — it carries opaque references (`h2a_ref`, `act.h2a_eng`) and enforces only identity, credential, audience, scope, and tenancy.
