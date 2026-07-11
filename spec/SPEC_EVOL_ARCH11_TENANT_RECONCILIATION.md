# SPEC_EVOL — ARCH-11 Tenant Reconciliation (`tenantId := workspaceId`)

Status: DESIGN v3 (architect-delegate). **Codex 2nd-engine adversarial pass reconciled** — all findings CONFIRMED
against code; the prior 2-peer Opus loop MISSED a real **cross-tenant OAuth-consent bypass** (§1.5), now fixed.
**Owner 2026-07-11: (A) model REAL multi-org now** — full `tenant = org` + `tenant_memberships` + cross-org
isolation from day one; prod rows backfill to their correct real org(s). **(B) ARCH-11 + account-broker EVOL are
ONE chantier under a single EXTERNAL gate G1** (bank connector, broker, multi-tenant mcp-platform), with
**internal execution STAGED G1a→G1d (§5), NOT a big-bang deploy.** Every claim cites `file:line`.

Owner decisions executed (do not re-open): **D1=B** tenant = org (`spec/SPEC_EVOL_ARCHITECTURE.md:662`); **D11=B**
published-contract breaking via major bump, gated on ARCH-12 (`:672`); **DD9=B** composite `(tenant_id,
workspace_id)` isolation, `tenantId` derived-from-workspace with a **pre-declared re-key** already accepted
(`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451`); **DD10=A** binding scope map = `tenantId`+`workspaceId` (`:452`).

## 1. Current state (grounded)

There is **no live link between a workspace and a tenant**. The identity families exist but are
disconnected, and product code papers over the gap by aliasing `tenantId := workspaceId`.

### 1.1 The alias — where `tenantId` is set to `workspaceId` today (7 sites)

- `comments.ts:22-25` `tenantOf(user) => { tenantId: user.workspaceId, … }`; `queue-manager.ts:1450`;
  `tool-service.ts:1288,1412,1662` (three); `catalog.ts:179` (`buildFoundationSkillsAuthz`).
- `personal-passthrough/caller-auth.ts:134` — **7th**: `CostContext.tenantId = principal.tenantId` where
  `principal.tenantId` (`:25`) is workspace-derived on the cookie path — the cost/quota ledger rides the alias.
- `pg-comment-store.ts:35` — store **IGNORES** `tenant.tenantId`, keys rows on `workspaceId` only.
- Forcing shape: `packages/contracts/src/index.ts:1-7` — `TenantContext` requires `tenantId, workspaceId,
  userId`; a caller lacking a real tenant passes the workspace id.

### 1.2 The real tenant family (IdP, BR-39e) — unrelated to workspaces

- `schema.ts:805-813` `tenants`: `id` = immutable slug == the `tid` claim (e.g. `'sentropic'`), `status`
  `active|suspended|offboarded`. No `workspace_id`.
- `schema.ts:820-841` `tenant_memberships`: per-`(user, tenant)`, `status` drives acceptance, `role`
  `member|admin`, unique `(tenant_id, user_id)`. A human is ONE `users` row with several memberships.
- `schema.ts:13-25` `workspaces`: has `ownerUserId`, `type`; **no `tenant_id`, no org column** — owned by a
  user, never bound to a tenant.
- `schema.ts:271` `oauth_clients.tenant_id` FK → `tenants.id` default `'sentropic'` — records which client a
  token was minted for. **NOT the S2S source** (§1.3). `schema.ts:5` `ADMIN_WORKSPACE_ID` is the default
  workspace FK on legacy rows (`:32,50,65,127,708`).

This is the "three tenant meanings" ARCH-11 reconciles (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:145`,
`spec/SPEC_EVOL_ARCHITECTURE.md:716`).

### 1.3 `tid` in tokens — human path only; S2S/NHI carry none

- `token-handler.ts:347-354` — `tid` bound at token time from a **still-`approved`** membership; dropped if
  suspended (`:369,:413`). Correct, but **authorization_code grant only**.
- `token-handler.ts:294` `issueServiceToken` (`client_credentials` / S2S) takes a `ServiceClientRecord`
  (`state-store-types.ts:70-82`), signs `client_id`, `scope`, `subject: client.clientId` (`:309-318`) with **NO
  `tid`**, **no on-behalf-of tenant input**, and **validates nothing**. Tokens are **stateless** (`:323`, no
  `oauth_tokens` row), 900s default TTL (`:10,:301`) — **cannot be un-minted** (rollback impact, §4.4). The S2S
  tenant lives on `service_clients.tenant_id` (`schema.ts:391`, nullable, no default) via
  `ServiceClientRecord.tenantId` (`state-store-types.ts:78`, `string | null`) — **not** `oauth_clients.tenant_id`.
  Any design keyed on `oauth_clients` for S2S fails G1 crit-3.
- `authz.ts:108-135` `resolveAuthorizedTenant` treats `claims.tid` as **sole authoritative** tenant; absent →
  `ambiguous_tenant` (`:114`); differing resolved hint → `cross_tenant` (`:126`); then **unconditionally**
  consults `authorizedTenants(sub, cid)` (`:129`), empty set → `no_enrollment` (`:132`). Blocks every cross-org
  connector AND (§1.6) single-org S2S too.
- **Corrected hazard**: `authz.ts:59` lists `workspaceId` in `TENANT_HINT_KEYS`, but `:120` marks only
  `tenantId|tid|tenant` as **direct**; `workspaceId` resolves only via the optional `tenantOfDomainHint` hook
  (`:121`, unset today) — currently **inert**. The gap is the missing cross-check, not a false-accept.

### 1.4 The forcing case — the bank connector

`spec/SPEC_EVOL_BANK_CONNECTOR.md:11` names the alias a **cross-org financial-data breach risk** and forbids
real bank data before ARCH-11. `:30` — level-2 S2S is safe pre-ARCH-11 **only if the app is single-org in
total**. `:76-77` — the connector's `resolveTenant(item_id|webhook)` "cannot be trusted for multi-org". `:96` —
**G1 = ARCH-11 done, `resolveTenant` trustworthy, no `tenantId:=workspaceId`** before cross-org persistence.

### 1.5 **Cross-tenant OAuth-consent bypass (SECURITY — Codex-found, prior loop MISSED)**

`oauth_consents` grants are keyed **only** `(user_id, client_id)` — no tenant leg: unique index `:343` (cols
`:332-345`); port `getGrant(userId, clientId)`/`saveGrant(userId, clientId, scopes)` (`ports.ts:314-319`);
`hasCoveringGrant` calls `getGrant(userId, clientId)` (`authorize-handler.ts:149`, superset-skip `:142-153`);
adapter filters `and(eq(userId), eq(clientId))` (`consent-store-adapter.ts:28,44`), upserts on that target
(`:52`). **Consequence under real multi-org (owner A):** a user in org-A and org-B who consented to client `X`
**once in org-A** has that grant transparently reused when `X` authorizes **in org-B** — consent is **skipped
for a tenant the user never granted**. A genuine cross-tenant authz gap, invisible today (single-org). Fixed by
tenantizing consent (§4.1.4, §4.2).

### 1.6 **Single-org S2S is blocked (Codex-found contradiction)**

The prior spec asserted single-org clients "need no enrollment rows". But `resolveAuthorizedTenant` calls
`authorizedTenants` **unconditionally** (`authz.ts:129`) and denies an empty set as `no_enrollment` (`:132`).
So a single-org S2S token carrying a correct `tid` **but no enrollment row** is DENIED. Resolver semantics must
be fixed (§2.1) so single-org clients resolve their fixed tenant **without** an enrollment row.

## 2. Target tenant identity model (real multi-org, owner A)

**tenant = org** (from `tenants`, id = slug = `tid`). **workspace = a product collaboration unit belonging to
exactly one tenant.** Cardinality: one tenant → many workspaces; one workspace → one tenant. Schema, isolation,
and tests support **many orgs from day one**; the single-`'sentropic'` state is just current row population,
never baked into code or tests. Cross-tenant shared workspaces are out of scope (study P4, `:41`).

Data change that closes the gap: add `workspaces.tenant_id text NOT NULL REFERENCES tenants(id)` — the single
new edge making `workspace → tenant` resolvable. A real FK is acceptable here until the IdP Phase-D extraction
degrades it to an ID reference (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:161-166`). The `ADD COLUMN` **must be
DEFAULT-safe** for rolling deploys (§4.1).

`TenantContext` / `AuthzContext` resolution (shape from `packages/contracts/src/index.ts:1-20`, unchanged):

- **First-party cookie session** (`api/src/middleware/auth.ts:80-110` resolves `workspaceId`): tenant is
  `resolveTenant({ workspaceId })` (§3). No token `tid` on the cookie path; workspace membership is the source.
- **Token path (OAuth / MCP)**: `tid` in the verified token is authoritative (`authz.ts:114`). A present
  `workspaceId` **must resolve (via §3) to the same tenant or fail closed** (`cross_tenant`), preserved by
  wiring `tenantOfDomainHint('workspaceId', …)` to `resolveTenant` — **not** by deleting `workspaceId` from the
  hint set (§4.2). `workspaceId` is a sub-tenant scope, never a direct tenant assertion.
- **S2S / NHI — on-behalf-of (OBO) mint, required now (owner A)**: `issueServiceToken` (`token-handler.ts:294`)
  must emit a `tid`, sourced by an OBO contract (§2.2), NOT deferred.

### 2.1 Authorized-tenant-set storage (new — required by multi-org, **soft-ref, DB-backed**)

`TenantResolver.authorizedTenants(principalSub, connectorInstanceId): string[]` (`authz.ts:61,129`) has **no
durable backing today** — the default `InMemoryTenantRegistry` (`authz.ts:245`) holds enrollments in memory,
but its `EnrollmentStore` is injectable (`authz.ts:246,249`). Multi-org needs a durable enrollment table living
in the **`control`** schema (it backs a control-plane resolver + the broker grant set):

```sql
control.connector_tenant_enrollments (
  principal_sub          text not null,  -- token subject; for S2S == service_clients.client_id (SOFT ref)
  connector_instance_id  text not null,  -- scopes enrollment per connector instance
  tenant_id              text not null,  -- SOFT ref to public.tenants(id); NO cross-namespace FK
  status                 text not null default 'active',  -- active | suspended
  primary key (principal_sub, connector_instance_id, tenant_id)
)
```

- **CONTROL no-cross-FK rule (Codex-found):** `control-schema.ts:9` forbids any FK to `public` tables. A
  `references(tenants.id)` FK **violates** it — use a **SOFT reference** (no DB FK; integrity service-enforced),
  matching `app_workspace_bindings` (`control-schema.ts:264-274`, "SOFT id ref … NO cross-namespace FK").
- **DB-backed adapter, not the in-memory port:** wire a Drizzle `EnrollmentStore` reading this table into the
  resolver (`authz.ts:246,249`); do NOT rely on `InMemoryTenantRegistry` (`authz.ts:245`) in prod.
- **Single-org resolves WITHOUT enrollment (§1.6 fix):** DB-backed `authorizedTenants(sub, cid)` returns
  `SELECT tenant_id … WHERE status='active'` **UNION** a single-org client's fixed `service_clients.tenant_id`
  (`schema.ts:391`) as a singleton. Enrollment rows exist **only** for multi-org sets; empty result stays
  `no_enrollment` (fail-closed, `authz.ts:132`).

### 2.2 S2S on-behalf-of (OBO) mint contract (new — required by multi-org)

`issueServiceToken` (`token-handler.ts:294`) gains an OBO tenant selector on the `client_credentials` grant:

- **Request parameter**: `tenant` (requested on-behalf-of org id) on the `POST /token` body, alongside
  `scope`/`resource`.
- **Validation (fail-closed)** against the client's authorized set (§2.1): *single-org* (fixed
  `service_clients.tenant_id`) → omitted binds the fixed tenant, supplied must equal it else `invalid_target`;
  *multi-org* (set > 1) → `tenant` **mandatory**, **null/absent FAILS CLOSED** (no default), out-of-set denies.
- **Emit `tid`:** the validated tenant is signed as `tid` (mirrors human path `token-handler.ts:352`);
  `mcp-platform` treats it authoritative (`authz.ts:113`).
- **Audit trail:** record `{ client_id, requested_tenant, resolved_tid, outcome }` per mint — the stateless token
  leaves the audit log as the only forensic record (rollback quarantine, §4.4).

## 3. `resolveTenant` — the contract downstream consumers depend on

One product-side seam, fail-closed, is the single source of `workspace → tenant`:

```ts
// api/src/services/tenancy/resolve-tenant.ts (new)
type ResolveTenantInput =
  | { workspaceId: string }
  | { clientId: string }            // S2S service client → service_clients.tenant_id (NOT oauth_clients)
  | { itemRef: string };            // connector-scoped handle (bank §4.1)
type ResolveTenantResult = { tenantId: string } | { error: 'unknown' | 'ambiguous_tenant' };
function resolveTenant(input: ResolveTenantInput): Promise<ResolveTenantResult>;
```

- **`{ workspaceId }`** → `SELECT tenant_id FROM workspaces WHERE id=$1` (cached); miss = `unknown` (deny).
- **`{ clientId }`** → `SELECT tenant_id FROM service_clients WHERE client_id=$1` (`schema.ts:391`) — S2S minter
  + egress. **Not** `oauth_clients`.
- **`{ itemRef }`** → connector-owned mapping (bank `resolveTenant(item_id|webhook)`, `…BANK_CONNECTOR.md:76`),
  delegating here for the tenant leg. `mcp-platform`'s `resolveAuthorizedTenant` (`authz.ts:108`) stays the
  token-side authority; the two must agree.

Invariants: (1) never returns a `workspaceId` as `tenantId`; (2) fail-closed — unresolved input denies, never
defaults; (3) idempotent + cacheable; (4) token `tid` wins when present and must match the resolved tenant.

## 4. Migration path (shared with the broker EVOL — owner B)

### 4.1 DATA — DEFAULT-safe order (rolling-deploy safe) — this is **G1a**

1. Ensure every **real** target `tenants` row exists (bootstrap `'sentropic'` at `schema.ts:806`, plus distinct
   first-party org rows this migration backfills into — owner A).
2. `ALTER TABLE workspaces ADD COLUMN tenant_id text DEFAULT '<org>' NOT NULL REFERENCES tenants(id)` — DEFAULT
   **and** NOT NULL in one step (PG ≥11 fast-default, no rewrite) so old + new pods both satisfy it during the
   roll; NOT NULL without a default breaks inserts from not-yet-rolled pods (rename-migration lesson: set the
   live DEFAULT, not only UPDATE rows). Backfill each workspace to its **correct real org** (map by owner/known
   org; unmapped → `'sentropic'`).
3. Backfill `tenant_memberships`: `approved`/`member` rows per distinct user × real org so `tid` can be minted
   (`token-handler.ts:352` requires an approved membership).
4. **Consent tenantization (SECURITY, §1.5), staged nullable → backfill → default → NOT NULL:**
   - `ALTER TABLE oauth_consents ADD COLUMN tenant_id text` (nullable first — DEFAULT-safe on rolling pods).
   - Backfill each existing grant's `tenant_id` from the consenting user's resolved tenant (their approved
     membership; single-org today → `'sentropic'`).
   - `ALTER COLUMN tenant_id SET DEFAULT '<org>'`, then `SET NOT NULL` once backfilled and all pods keyed.
   - Replace the unique index `(user_id, client_id)` (`schema.ts:343`) with `(user_id, client_id, tenant_id)`.
5. Re-key the **NOT-NULL grandfather** columns the alias populated with a workspace id, each **DEFAULT-safe**,
   to the **real tenant** (not the workspace): `control.app_instances.tenant_id` (`control-schema.ts:213`) +
   `identity_tenant_id` (`:214`); `app_workspace_bindings.tenant_id` (`:274`, already correct shape) +
   `identity_tenant_id` (`:275`); `object_type_definitions.tenant_id` (`:123`, nullable — only tenant-scoped rows).
6. `service_clients`: `UPDATE … SET tenant_id='<org>'` **and** `ALTER COLUMN tenant_id SET DEFAULT '<org>'`
   (`schema.ts:391` has no default) so new single-org clients inherit a tenant. Nullable token-tenant columns
   (`authorization_codes.tenant_id`, `oauth_tokens.tenant_id` `:316`, `revoked_tokens.tenant_id` `:359`) stay nullable.
7. **Pre-declared re-key of JSONB + rows** (DD9, `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451,192`): rows with
   `tenantId = workspaceId` — UBO scope map (`ubo-contracts/src/types.ts:13`, `resource-plane/ref.ts:11`) and
   outbox (`outbox-writer.ts:107` column **and** the JSONB `envelope` `:103`). `EventEnvelope.tenant` is a full
   `TenantContext` (`contracts:40,44`), so the re-key must rewrite the embedded `envelope->tenant->>tenantId`
   JSONB copy, **not only** the column. Emit a `tenant.rekeyed` event through the spine (§7).

### 4.2 CODE

1. Add `resolveTenant` (§3) with an in-process cache.
2. Replace every alias site with the resolved tenant: `comments.ts:24`, `queue-manager.ts:1450`,
   `tool-service.ts:1288/1412/1662`, `catalog.ts:179`, `personal-passthrough/caller-auth.ts:134`.
   - **Async ripple (catalog)**: `buildFoundationSkillsAuthz` (`catalog.ts:174`) + callers are **sync**.
     **Preferred**: resolve tenant **upstream** and thread `tenantId` into `ResolveFoundationChatToolsInput`,
     keeping the builder sync; go async only if impractical.
3. `pg-comment-store.ts:35` — additionally filter on `tenantId` (defense in depth) once populated; drop the
   "ignores tenantId" convention.
4. **Keep** `workspaceId` in `TENANT_HINT_KEYS` (`authz.ts:59`) but wire a `tenantOfDomainHint` mapping
   `('workspaceId', wsId) → resolveTenant({workspaceId})`, so a `workspaceId` disagreeing with token `tid` still
   yields `cross_tenant` (`authz.ts:126`). **Do not delete the key** — that removes the cross-check.
5. **Consent (§1.5):** add `tenantId` to `getGrant/saveGrant` (`ports.ts:314-319`), thread the authorize-flow
   tenant into `hasCoveringGrant` (`authorize-handler.ts:142-153`, call `:149`), key the adapter queries
   `(userId, clientId, tenantId)` (`consent-store-adapter.ts:28,44,52`). An org-A grant never satisfies org-B.
6. **S2S OBO (§2.2):** add the `tenant` parameter + validation + `tid` emission to `issueServiceToken`
   (`token-handler.ts:294`); single-org from `service_clients.tenant_id`, multi-org validated against
   `connector_tenant_enrollments` (§2.1); null OBO on a multi-org client fails closed; audit every mint.
7. Fail-closed everywhere: an unresolved tenant throws; **no fallback to `workspaceId`** (MASTER "no legacy
   fallback"). Delete the alias comments.

### 4.3 ROLLOUT — this is **G1b**

- Flag `TENANT_RESOLUTION_MODE = alias | shadow | strict`.
- **shadow**: compute both resolved tenant and legacy alias; emit
  `tenant_resolution_divergence_total{mode="shadow",path,pod}` on each divergence + `tenant_resolution_total`
  denominator. **Gate window**: divergence must read **0 across a full deploy-generation window (all pods rolled,
  ≥ one steady-state interval, e.g. 24h)**, per-pod label so an un-rolled pod is visible — meaningful **because
  real multi-org exists** (owner A). Ship shadow to prod first.
- **strict**: `resolveTenant` authoritative and fail-closed. Flip **only after divergence = 0 across ALL rolled
  pods** for the window. Remove `alias` + dead code once strict is stable.

### 4.4 ROLLBACK (failed strict cutover) — **containment, not just a mode revert**

`TENANT_RESOLUTION_MODE` reverts the **product-path** config-only (`strict → shadow`/`alias`, no schema rollback
— §4.1 is non-destructive). **BUT that alone is insufficient for the token/consent legs:** S2S/NHI tokens are
**stateless and cannot be un-minted** (`token-handler.ts:323`, 900s TTL `:10`), so a bad `tid` keeps validating
until it expires. Runbook, in order:
1. **Disable multi-org egress** — stop issuing OBO `tid` (revert `issueServiceToken` to single-org), so no new
   cross-org tokens mint.
2. **Drain or revoke outstanding tokens** — wait the ≤900s TTL, or add the `jti`s to `revoked_tokens`
   (`schema.ts:359`) for immediate cutoff.
3. **Quarantine new state** — suspend (not delete) window-written enrollment rows
   (`connector_tenant_enrollments.status='suspended'`), hold newly-tenantized consent grants
   (`oauth_consents.tenant_id`) + broker grants; the S2S audit log (§2.2) indexes what to quarantine.
4. **Then** revert `TENANT_RESOLUTION_MODE`, capture divergence rows, fix `resolveTenant`/enrollment data,
   re-enter shadow.

§4.2's alias-comment deletions are irreversible and land **after** strict is stable, never in the cutover commit.

### 4.5 BACKWARD-COMPAT (D11=B)

`TenantContext` field shape is unchanged → **no structural break** to `@sentropic/contracts`. But the
**semantics** change (`tenantId` no longer equals `workspaceId`). A published consumer relying on that equality
is a **semantic** breaking change → **major bump** with a migration note, gated on ARCH-12
(`spec/SPEC_EVOL_ARCHITECTURE.md:672,717`). Consumers keying on `workspaceId` (comment store, RBAC) are
unaffected; consumers reading `tenantId` now get the real tenant.

## 5. Combined gate G1 — ONE external gate, STAGED internal execution (owner B)

ARCH-11 and the account-broker EVOL are **one gated chantier**; **G1 is the single EXTERNAL gate** the bank
connector, broker, and multi-tenant mcp-platform consume. **Internal execution is STAGED (Codex-found: not a
big-bang deploy):**

- **G1a — DATA (DEFAULT-safe, no behavior change).** §4.1: `workspaces.tenant_id`, memberships, consent
  `tenant_id` (nullable→backfill→default→NOT NULL), grandfather re-key, `service_clients` default. Ships alone.
- **G1b — shadow → strict.** §4.3: ship `resolveTenant`, shadow in prod, flip strict only after divergence 0
  across the window. Product-path only.
- **G1c — S2S OBO + enrollment + consent enforcement.** §2.1/§2.2/§4.2.5-6: DB-backed enrollment resolver, OBO
  `tid` mint (fail-closed validation), tenantized consent lookups. Enables multi-org token/consent isolation.
- **G1d — broker grants.** `AccessGrant`/`resource_grants` keyed on the reconciled tenant; multi-org egress open.

**G1 (external) holds only when ALL are true:**
1. **No alias remains**: grep-clean for `tenantId := workspaceId` / `tenantId: workspaceId` in `api/**` and
   `packages/**`, enforced by a CI guard (all 7 sites, §1.1).
2. `workspaces.tenant_id` is `NOT NULL`, FK-enforced, fully backfilled to **real** orgs.
3. `resolveTenant` is the single tenant-resolution seam, fail-closed, pointing `{clientId}` at
   `service_clients` (not `oauth_clients`).
4. S2S/NHI tokens carry `tid` via the OBO contract (§2.2): single-org from `service_clients.tenant_id`, multi-org
   validated against `connector_tenant_enrollments`, **null OBO fails closed**; `mcp-platform` derives tenant
   from `tid`, product paths from `resolveTenant`, cross-checked (mismatch = `cross_tenant`, `authz.ts:126`).
5. `connector_tenant_enrollments` (§2.1) exists as a **soft-ref control table** backing a **DB-backed**
   `authorizedTenants`; single-org clients resolve without a row (§1.6 fix).
6. **`oauth_consents` is keyed `(user_id, client_id, tenant_id)`** (§1.5): a grant in one org never skips consent
   in another. CI test proves org-B authorize does not reuse an org-A grant.
7. **Real, NON-VACUOUS cross-org isolation test green.** The fixture **seeds** ≥2 real orgs with `tenants`,
   `workspaces` (each mapped), `tenant_memberships`, minted human + S2S tokens (`tid`),
   `connector_tenant_enrollments` rows, and DD9 composite `(tenant_id, workspace_id)` rows, then asserts org-B
   never resolves org-A's tenant/workspace/token/consent/data via `resolveTenant`, the `authorizedTenants` set,
   a DD9 query, AND the consent path — all deny (`…BANK_CONNECTOR.md:146,113`). A single-org fixture is vacuous.
8. Prod in `strict` on **all** pods; divergence metric 0 across the full window (§4.3).

## 6. Blast radius — everything assuming `tenantId == workspaceId`

7 alias sites (§1.1) + tenant-blind comment filter (`pg-comment-store.ts:35`); the **cross-tenant consent
bypass** (`schema.ts:343`, `ports.ts:314-319`, `consent-store-adapter.ts:28`, `authorize-handler.ts:149`, §1.5);
the `mcp-platform` cross-check gap + single-org enrollment block (`authz.ts:59,120,129`, §1.6); the S2S OBO gap
(`token-handler.ts:294,309`, §2.2); the catalog async ripple (§4.2.2); outbox `tenant_id` + JSONB
`envelope.tenant.tenantId` (`outbox-writer.ts:103,107`); the UBO scope map (`ubo-contracts/src/types.ts:13`,
`resource-plane/ref.ts:11`); the quota/cost ledger + `CostContext` (`caller-auth.ts:134`); control-plane
grandfather columns `app_instances.tenant_id` (`:213`), `app_workspace_bindings.tenant_id` (`:274`),
`object_type_definitions.tenant_id` (`:123`) + `identity_tenant_id` (`:214,:275`).

**Sequencing = G1a→G1d** (§5): DATA → `resolveTenant` → **shadow** → strict (all pods rolled, divergence 0) →
S2S OBO `tid` + DB-backed enrollment + consent enforcement → re-key UBO/outbox JSONB → broker grants + multi-org.

## 7. Dependencies / relations

- **ARCH-14 event spine.** `EventEnvelope.tenant` is a `TenantContext` (`contracts:40,44`); the outbox carries
  `tenant_id` **and** the embedded envelope JSONB (`outbox-writer.ts:103,107`). ARCH-11 defines the tenant
  semantics the spine keys on and precedes durable UBO storage (DD9 accepted the **re-key posture**,
  `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451`); the re-key is emitted through this spine.
- **39h agent identity / NHI.** S2S/NHI tokens must carry `tid` via the OBO contract (§2.2; study `:140,:485`);
  a NHI on behalf of a tenant needs a verifiable binding + DPoP (`:530`). ARCH-11 supplies the tenant, 39h the
  agent identity; cross-agent grants gated on **both** (study P4, `:41`).
- **Broker `AccessGrant` (coupled under G1d).** `AccessGrant.scope` is a `ScopeMap` over tenant/workspace/resource
  (`SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:278-282`); it must key on the reconciled `tenantId` (`:526`).
  Its authorized-grant set is stored by `connector_tenant_enrollments` (§2.1); `resource_grants` persistence is
  **part of the same G1 chantier**, not a downstream dependency.

## 8. Risks + residual

- **Silent cross-org leak** if `strict` flips before backfill completes or every pod is rolled (P0 lesson).
  Mitigation: shadow-divergence gate (§4.3) + fail-closed `resolveTenant` + staged G1a→G1d.
- **Cross-tenant consent reuse** (§1.5) persists until G1c enforces the tenantized key; the nullable→NOT NULL
  stage (§4.1.4) is the window. Mitigation: G1 crit-6 test + backfill audit.
- **Un-minted S2S tokens** (§4.4): a bad multi-org `tid` cannot be recalled mid-flight — egress-disable +
  TTL/revocation only. Residual = up to one 900s TTL of exposure per bad token unless revoked.
- **Wrong-org backfill** of workspaces/consents (owner A) can mis-assign; unmapped → `'sentropic'`. Mitigation:
  the non-vacuous cross-org test (crit-7) + a backfill audit before strict.
- **Enrollment drift**: `connector_tenant_enrollments` is the sole multi-org authority; a stale/over-broad row
  is a cross-org grant. Mitigation: fail-closed empty-set (`authz.ts:132`) + status + audit + quarantine.
- **One-tenant-per-workspace FK** blocks workspace-atom cross-tenant sharing (study P4) — intentional.
- **Semantic contract break** (§4.5) can surprise external consumers if only additively published.
</content>
</invoke>
