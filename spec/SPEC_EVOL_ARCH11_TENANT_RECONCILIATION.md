# SPEC_EVOL — ARCH-11 Tenant Reconciliation (`tenantId := workspaceId`)

Status: DESIGN (architect-delegate). **Owner decisions 2026-07-11: (A) model REAL multi-org now** — full
`tenant = org` + `tenant_memberships` + real cross-org isolation from day one; existing prod rows backfill to
their correct real org(s). **(B) ARCH-11 + the account-broker EVOL are ONE gated chantier under a single
combined gate G1** consumed by the bank connector, the broker, and multi-tenant mcp-platform (shared migration,
cutover, criteria). 2-peer Opus review reconciled; Codex adversarial pass owed. Every claim cites `file:line`.

Owner decisions this spec executes (do not re-open): **D1=B** tenant = org/account
(`spec/SPEC_EVOL_ARCHITECTURE.md:662`); **D11=B** published-contract breaking via major bump, gated on
ARCH-12 (`:672`); **DD9=B** composite `(tenant_id, workspace_id)` isolation, `tenantId` derived-from-workspace
pending ARCH-11 with a **pre-declared re-key** already accepted (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451`);
**DD10=A** binding-defined scope map, Sentropic binding = `tenantId`+`workspaceId` (`:452`).

---

## 1. Current state (grounded)

There is **no live link between a workspace and a tenant**. The identity families exist but are
disconnected, and product code papers over the gap by aliasing `tenantId := workspaceId`.

### 1.1 The alias — where `tenantId` is set to `workspaceId` today

- `api/src/routes/api/comments.ts:22-25` — `tenantOf(user) => { tenantId: user.workspaceId, workspaceId, userId }`.
- `api/src/services/queue-manager.ts:1450` — `{ tenantId: workspaceId, workspaceId, userId: createdBy }`.
- `api/src/services/tool-service.ts:1288, 1412, 1662` — `{ tenantId: workspaceId, ... }` (three sites).
- `api/src/services/skills/catalog.ts:179` — `tenantId: input.workspaceId` inside `buildFoundationSkillsAuthz`.
- `packages/llm-gateway/src/personal-passthrough/caller-auth.ts:134` — **7th site**: `cost: CostContext =
  { tenantId: principal.tenantId, ... }` where `principal.tenantId` (`:25`) is workspace-derived on the
  cookie path. The cost/quota ledger key rides the alias.
- `api/src/services/comments/pg-comment-store.ts:35` — the store **IGNORES** `tenant.tenantId` and keys rows
  on `workspaceId` only ("live convention `tenantId := workspaceId`").
- Contract shape forcing the alias: `packages/contracts/src/index.ts:1-7` — `TenantContext` requires
  `tenantId`, `workspaceId`, `userId`; every caller must supply a `tenantId` and, lacking a real one, passes
  the workspace id.

### 1.2 The real tenant family (IdP, BR-39e) — unrelated to workspaces

- `api/src/db/schema.ts:805-813` — `tenants`: `id` is the immutable slug == the `tid` claim (e.g.
  `'sentropic'`), `status` `active|suspended|offboarded`. No `workspace_id`.
- `api/src/db/schema.ts:820-841` — `tenant_memberships`: per-`(user, tenant)`, `status` drives acceptance,
  `role` `member|admin`, unique `(tenant_id, user_id)`. A human is ONE `users` row with several memberships.
- `api/src/db/schema.ts:13-25` — `workspaces`: has `ownerUserId` and `type`; **no `tenant_id`, no org column**.
  A workspace is owned by a user, never bound to a tenant.
- `api/src/db/schema.ts:271` — `oauth_clients.tenant_id` FK → `tenants.id` default `'sentropic'` — records
  which client a token was minted for. **This is NOT the S2S source** (see §1.3).
- `api/src/db/schema.ts:5` — `ADMIN_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001'`, the default
  workspace FK on legacy rows (`:32,50,65,127,708`).

This is the "three tenant meanings" ARCH-11 reconciles (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:145`,
`spec/SPEC_EVOL_ARCHITECTURE.md:716`).

### 1.3 `tid` in tokens — human path only; S2S/NHI carry none

- `packages/auth-hono/src/oauth/token-handler.ts:347-354` — `tid` bound at token time from a **still-`approved`**
  membership; dropped if suspended (`:369` access, `:413` id_token). Correct, but **authorization_code grant only**.
- `packages/auth-hono/src/oauth/token-handler.ts:294` `issueServiceToken` (the `client_credentials` / S2S path)
  takes a **`ServiceClientRecord`** (`state-store-types.ts:70-82`) and signs `client_id`, `scope`,
  `subject: client.clientId` (`token-handler.ts:309-319`) with **NO `tid`**. Confirmed: S2S/NHI tokens carry no
  tenant (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:140`). **Corrected table**: the S2S tenant lives
  on `service_clients.tenant_id` (`schema.ts:391`, nullable, **no default**) via `ServiceClientRecord.tenantId`
  (`state-store-types.ts:78`) — **not** `oauth_clients.tenant_id`. Any design keyed on `oauth_clients` for S2S
  fails G1 crit-4 for every existing service client.
- `packages/mcp-platform/src/authz.ts:112-135` `resolveAuthorizedTenant` treats `claims.tid` as the **sole
  authoritative** tenant; absent tid → `ambiguous_tenant` (fail-closed, `:114`); a differing resolved hint →
  `cross_tenant` (`:126`); an unenrolled principal (`authorizedTenants` empty set) → `no_enrollment` (`:132`).
  Multi-tenant MCP over S2S **cannot pass today** — safe but blocks every cross-org connector.
- **Corrected hazard (was overstated)**: `authz.ts:59` lists `workspaceId` in `TENANT_HINT_KEYS`, but `:120`
  marks only `tenantId|tid|tenant` as **direct** assertions; `workspaceId` resolves **only** via the **optional**
  `tenantOfDomainHint` hook (`:121`, interface `:63`), unset today — so a `workspaceId` hint is currently
  **inert**, not "accepted as a tenant assertion". The real gap is the missing cross-check, not a false-accept.

### 1.4 The forcing case — the bank connector

`spec/SPEC_EVOL_BANK_CONNECTOR.md:11` names the alias a **cross-org financial-data breach risk** and forbids
real bank data before ARCH-11. `:30` — level-2 S2S is safe pre-ARCH-11 **only if the app is single-org in
total**; multi-org S2S is G1-gated. `:76-77` — the connector's `resolveTenant(item_id|webhook)` "cannot be
trusted for multi-org (it would ride the broken key)". `:96` — **G1 = ARCH-11 done, `resolveTenant`
trustworthy, no `tenantId:=workspaceId`** before any cross-org token/consent persistence.

---

## 2. Target tenant identity model (real multi-org, owner A)

**tenant = org** (from `tenants`, id = slug = `tid`). **workspace = a product collaboration unit that belongs
to exactly one tenant.** Cardinality: one tenant → many workspaces; one workspace → one tenant. The schema,
isolation, and tests support **many orgs from day one**; the single-`'sentropic'` state is just the current
row population, never an assumption baked into code or tests. Cross-tenant shared workspaces (workspace-atom
sharing) are out of scope (study P4, `:41`).

Data change that closes the gap:

- Add `workspaces.tenant_id text NOT NULL REFERENCES tenants(id)` — the single new edge that makes
  `workspace → tenant` resolvable. A real FK is acceptable here (both product/identity-side today) until the
  IdP Phase-D extraction degrades it to an ID reference (`spec/SPEC_EVOL_DATA_ARCHITECTURE.md:161-166`). The
  `ADD COLUMN` **must be DEFAULT-safe** for rolling deploys — see §4.1.

`TenantContext` / `AuthzContext` resolution (shape from `packages/contracts/src/index.ts:1-20`, unchanged):

- **First-party cookie session** (`api/src/middleware/auth.ts:80-110` resolves `workspaceId`): tenant is
  `resolveTenant({ workspaceId })` (§3). No token `tid` on the cookie path, so workspace membership is the
  source and the resolved tenant is authoritative.
- **Token path (OAuth / MCP / S2S)**: `tid` in the verified token is authoritative (`authz.ts:114`). When a
  `workspaceId` is also present it **must resolve (via §3) to the same tenant or fail closed** (`cross_tenant`).
  This cross-check is preserved by wiring `tenantOfDomainHint('workspaceId', …)` to `resolveTenant` — **not**
  by deleting `workspaceId` from the hint set (which would silently remove the check; see §4.2). `workspaceId`
  is a sub-tenant scope, never a direct tenant assertion.
- **S2S / NHI**: `issueServiceToken` (`token-handler.ts:294`) must emit a `tid`. A **single-org** client binds
  `tid` = `ServiceClientRecord.tenantId` (`state-store-types.ts:78` ← `service_clients.tenant_id`,
  `schema.ts:391`). A **multi-org** egress client (bank serving several ERPs) carries no fixed `tid`; it passes
  a per-invocation on-behalf-of tenant that the egress validates against the client's **authorized tenant set**
  (§2.1) using the `authorizedTenants` fail-closed check already in `authz.ts:129-132`. Owner A makes this path
  **required now**, not deferred.

### 2.1 Authorized-tenant-set storage (new — required by multi-org)

`TenantResolver.authorizedTenants(principalSub, connectorInstanceId): string[]` (`authz.ts:61,129`) has **no
backing store today** — it is an in-memory port. Multi-org needs a durable enrollment table:

```sql
control.connector_tenant_enrollments (
  principal_sub          text not null,  -- token subject; for S2S == service_clients.client_id
  connector_instance_id  text not null,  -- scopes enrollment per connector instance
  tenant_id              text not null references tenants(id),
  status                 text not null default 'active',  -- active | suspended
  primary key (principal_sub, connector_instance_id, tenant_id)
)
```

`authorizedTenants(sub, cid)` = `SELECT tenant_id WHERE principal_sub=sub AND connector_instance_id=cid AND
status='active'`. Empty set stays `no_enrollment` (fail-closed, `authz.ts:132`). Single-org service clients
need no rows here — their `tid` comes from `service_clients.tenant_id`; the enrollment table is only consulted
for multi-org egress. This is the storage the broker's `AccessGrant` set (§7) and the bank egress both consume.

---

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

- **`{ workspaceId }`** → `SELECT tenant_id FROM workspaces WHERE id=$1` (cached). Miss = `unknown` (deny).
- **`{ clientId }`** → `SELECT tenant_id FROM service_clients WHERE client_id=$1` (`schema.ts:391`). Used by the
  S2S minter and the egress. **Not** `oauth_clients`.
- **`{ itemRef }`** → connector-owned mapping (bank's `resolveTenant(item_id|webhook)`,
  `spec/SPEC_EVOL_BANK_CONNECTOR.md:76`), which delegates to this seam for the tenant leg and adds provider-item
  custody. `mcp-platform`'s `resolveAuthorizedTenant` (`authz.ts:108`) stays the token-side authority; the two
  must agree.

Invariants: (1) never returns a `workspaceId` as a `tenantId`; (2) fail-closed — unresolved input denies, never
defaults; (3) idempotent + cacheable; (4) token `tid`, when present, wins and must match the resolved tenant or
the call denies.

---

## 4. Migration path (shared with the broker EVOL — owner B)

### 4.1 DATA — DEFAULT-safe order (rolling-deploy safe)

1. Ensure every **real** target `tenants` row exists (bootstrap `'sentropic'` at `schema.ts:806`, plus any
   distinct first-party org rows this migration backfills into — owner A).
2. `ALTER TABLE workspaces ADD COLUMN tenant_id text DEFAULT '<org>' NOT NULL REFERENCES tenants(id)`. **Add the
   column WITH a DEFAULT and NOT NULL in one step** (PG ≥11 fast-default, no rewrite) so old and new pods both
   satisfy the constraint during the roll. NOT NULL **without** a default would break inserts from not-yet-rolled
   pods (rename-migration lesson: set the live DEFAULT, not only UPDATE rows). Backfill each workspace to its
   **correct real org** (not a blanket `'sentropic'`): map by owner/known org; unmapped rows → `'sentropic'`.
3. Backfill `tenant_memberships`: insert `approved`/`member` rows per distinct user × their real org so `tid`
   can be minted (`token-handler.ts:352` requires an approved membership).
4. Re-key the **NOT-NULL grandfather** columns the alias silently populated with a workspace id (or a stale
   IdP-tenant value), each **DEFAULT-safe**:
   - `control.app_instances.tenant_id` (`control-schema.ts:213`, NOT NULL) + reconcile `identity_tenant_id`
     (`:214`, nullable — the IdP-tenant leg).
   - `control.app_workspace_bindings.tenant_id` (`control-schema.ts:274`, NOT NULL) + `identity_tenant_id`
     (`:275`). This table is already the **correct target shape** (separate tenant + workspace,
     `app-control-plane.ts:130,402`); populate the **real tenant**, not the workspace.
   - `control.object_type_definitions.tenant_id` (`control-schema.ts:123`, **nullable**, null = global type):
     re-key only tenant-scoped custom-type rows; no NOT-NULL/DEFAULT concern.
5. `service_clients`: `UPDATE service_clients SET tenant_id='<org>'` for existing rows **and** `ALTER COLUMN
   tenant_id SET DEFAULT '<org>'` (`schema.ts:391` has no default today) so newly-provisioned single-org
   clients inherit a tenant (fixes G1 crit-4). Nullable token-tenant columns (`authorization_codes.tenant_id`
   `:289`, `oauth_tokens.tenant_id` `:316`, `revoked_tokens.tenant_id` `:359`) stay nullable; no re-key needed.
6. **Pre-declared re-key of JSONB + rows** (DD9, `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451,192`): rows written with
   `tenantId = workspaceId` — the UBO envelope scope map (`packages/ubo-contracts/src/types.ts:13`,
   `api/src/services/resource-plane/ref.ts:11`) and outbox rows (`api/src/services/outbox/outbox-writer.ts:107`
   column **and** the JSONB `envelope` `:100-108`). `EventEnvelope.tenant` is a full `TenantContext`
   (`contracts:44`), so the re-key must rewrite the embedded `envelope->tenant->>tenantId` JSONB copy, **not
   only** the `tenant_id` column. Emit a `tenant.rekeyed` event through the spine (§7).

### 4.2 CODE

1. Add `resolveTenant` (§3) with an in-process cache.
2. Replace every alias site with the resolved tenant: `comments.ts:24`, `queue-manager.ts:1450`,
   `tool-service.ts:1288/1412/1662`, `catalog.ts:179`, `personal-passthrough/caller-auth.ts:134`.
   - **Async ripple (catalog)**: `buildFoundationSkillsAuthz` (`catalog.ts:174`) is **sync** and its callers
     `resolveFoundationChatTools` (`:204`) and `executeFoundationSearchSkills` (`:227`) are sync, invoking sync
     registry methods. `await resolveTenant` would force the whole chain async. **Preferred**: resolve the tenant
     **upstream** and thread the resolved `tenantId` into `ResolveFoundationChatToolsInput`, keeping the builder
     sync; only fall back to making the chain async if upstream resolution is impractical.
3. `pg-comment-store.ts:35` — additionally filter on `tenantId` (defense in depth) once populated; drop the
   "ignores tenantId" convention.
4. **Keep** `workspaceId` in `TENANT_HINT_KEYS` (`authz.ts:59`) but wire a `tenantOfDomainHint` implementation
   that maps `('workspaceId', wsId) → resolveTenant({workspaceId})`, so a `workspaceId` that disagrees with the
   token `tid` still yields `cross_tenant` (`authz.ts:126`). **Do not delete the key** — that would remove the
   cross-check (resolves the §2/§4.2 contradiction).
5. Add the `tid` claim to `issueServiceToken` (`token-handler.ts:294`): single-org from
   `ServiceClientRecord.tenantId`; multi-org egress validates the on-behalf-of tenant against
   `connector_tenant_enrollments` (§2.1).
6. Fail-closed everywhere: an unresolved tenant throws; **no fallback to `workspaceId`** (MASTER "no legacy
   fallback"). Delete the alias comments.

### 4.3 ROLLOUT

- Flag `TENANT_RESOLUTION_MODE = alias | shadow | strict`.
- **shadow**: compute both the resolved tenant and the legacy alias; emit metric
  `tenant_resolution_divergence_total{mode="shadow",path,pod}` (counter) each time they differ, plus
  `tenant_resolution_total` as the denominator. **Gate window**: divergence must read **0 across a full
  deploy-generation window (all pods rolled, ≥ one steady-state interval, e.g. 24h)** with a per-pod label so a
  single un-rolled pod is visible — divergence is only meaningful **because real multi-org exists** (owner A);
  under a single org it would be vacuously 0. Ship shadow to prod first.
- **strict**: `resolveTenant` is authoritative and fail-closed. Flip **only after divergence = 0 across ALL
  rolled pods** for the window above.
- Remove `alias` mode + dead code once strict is stable.

### 4.4 ROLLBACK (failed strict cutover)

`TENANT_RESOLUTION_MODE` is the rollback lever: `strict → shadow` (or `alias`) is a **config-only, no-migration**
revert restoring the legacy path within one deploy. The DATA migration (§4.1) is **non-destructive** (added
columns/defaults, no drops), so a mode revert needs no schema rollback. Keep `alias` mode + legacy path resident
until strict holds the full window; §4.2.6's deletions are irreversible and land **after** strict is stable,
never in the cutover commit. On cross-tenant denials: revert mode, capture divergence rows, fix
`resolveTenant`/enrollment data, re-enter shadow.

### 4.5 BACKWARD-COMPAT (D11=B)

`TenantContext` field shape is unchanged → **no structural break** to `@sentropic/contracts`. But the
**semantics** change (`tenantId` no longer equals `workspaceId`). A published consumer relying on that equality
is a **semantic** breaking change → **major bump** with a migration note, gated on ARCH-12 (`spec/SPEC_EVOL_ARCHITECTURE.md:672,717`).
Consumers keying on `workspaceId` (comment store, RBAC) are unaffected; consumers reading `tenantId` now get the
real tenant.

---

## 5. Combined gate G1 — "ARCH-11 + broker foundation done" (owner B)

ARCH-11 and the account-broker EVOL are **one gated chantier**; **G1 is the single combined gate** the bank
connector, the broker, and multi-tenant mcp-platform all consume. G1 holds only when ALL are true:
1. **No alias remains**: grep-clean for `tenantId := workspaceId` / `tenantId: workspaceId` in `api/**` and
   `packages/**`, enforced by a CI guard (all 7 sites, §1.1).
2. `workspaces.tenant_id` is `NOT NULL`, FK-enforced, fully backfilled to **real** orgs.
3. `resolveTenant` is the single tenant-resolution seam, fail-closed, and points `{clientId}` at
   `service_clients` (not `oauth_clients`).
4. S2S/NHI tokens carry `tid`; single-org from `service_clients.tenant_id`, multi-org from
   `connector_tenant_enrollments`; `mcp-platform` derives tenant from `tid`, product paths from `resolveTenant`,
   and the two are cross-checked (mismatch = `cross_tenant`, `authz.ts:126`).
5. `connector_tenant_enrollments` (§2.1) exists and backs `authorizedTenants`.
6. **Real cross-org isolation test green** (not vacuous): with ≥2 orgs seeded, org-B can never resolve org-A's
   tenant/workspace/token/data — assert `resolveTenant`, the `authorizedTenants` set, and a DD9 composite
   `(tenant_id, workspace_id)` query all deny cross-org (`spec/SPEC_EVOL_BANK_CONNECTOR.md:146,113`).
7. Prod in `strict` on **all** pods; divergence metric 0 across the full window (§4.3).

---

## 6. Blast radius — everything assuming `tenantId == workspaceId`

7 alias sites (§1.1) + tenant-blind comment filter (`pg-comment-store.ts:35`); the `mcp-platform` cross-check
gap (`authz.ts:59,120`); the catalog async ripple (§4.2.2); outbox `tenant_id` column **and** JSONB
`envelope.tenant.tenantId` (`outbox-writer.ts:100-108`; `queue-manager.ts:1723` passes `null`); the UBO scope
map (`ubo-contracts/src/types.ts:13`, `resource-plane/ref.ts:11`); the quota/cost ledger + gateway `CostContext`
(`caller-auth.ts:134`, `spec/SPEC_EVOL_ARCHITECTURE.md:262`); control-plane grandfather columns
`app_instances.tenant_id` (`:213`), `app_workspace_bindings.tenant_id` (`:274`),
`object_type_definitions.tenant_id` (`:123`) + `identity_tenant_id` (`:214,:275`).

**Sequencing**: DATA (`workspaces.tenant_id` + memberships + grandfather re-key + `service_clients` default) →
`resolveTenant` shipped → **shadow** in prod → strict cutover **only after all pods rolled & divergence 0** →
S2S `tid` + enrollment → re-key UBO/outbox JSONB → open multi-org (bank G1).

---

## 7. Dependencies / relations

- **ARCH-14 event spine.** `EventEnvelope.tenant` is a `TenantContext` (`contracts:44`); the outbox carries a
  `tenant_id` column **and** the embedded envelope JSONB (`outbox-writer.ts:100-108`). ARCH-11 defines the tenant
  semantics the spine keys on and precedes durable UBO storage lots (DD9 accepted the **re-key posture** rather
  than blocking storage, `spec/SPEC_EVOL_DATA_ARCHITECTURE.md:451`). The re-key is emitted through this spine.
- **39h agent identity / NHI.** S2S/NHI tokens must carry `tid` (§1.3; study `:140,:485`); a NHI acting on
  behalf of a tenant needs a verifiable binding + DPoP (`:530`). ARCH-11 supplies the tenant; 39h the agent
  identity. Cross-agent grants gated on **both** (study P4, `:41`).
- **Broker `AccessGrant` primitive (coupled under G1).** `AccessGrant.scope` is a `ScopeMap` over
  tenant/workspace/resource (`spec/SPEC_STUDY_UNIVERSAL_CONNECTOR_ACCOUNT_BROKER.md:278-282`); it must key on the
  reconciled `tenantId` ("workspace grants before ARCH-11 may encode the wrong tenant key", `:526`). The broker's
  authorized-grant set is stored by `connector_tenant_enrollments` (§2.1). `AccessGrant` / `resource_grants`
  persistence is **part of the same G1 chantier**, not a downstream dependency.

---

## 8. Risks + residual

- **Silent cross-org leak** if `strict` is flipped before backfill completes or before every pod is rolled
  (the P0 lesson). Mitigation: shadow-divergence gate (§4.3) + fail-closed `resolveTenant` + config-only rollback (§4.4).
- **Wrong-org backfill**: mapping existing workspaces to real orgs (owner A) can mis-assign; unmapped → `'sentropic'`.
  Mitigation: the real cross-org isolation test (G1 crit-6) + a backfill audit before strict.
- **One-tenant-per-workspace FK** blocks workspace-atom cross-tenant sharing (study P4) — intentional; a mapping
  table would be needed later.
- **Enrollment drift**: `connector_tenant_enrollments` is the sole multi-org authority; a stale/over-broad row is
  a cross-org grant. Mitigation: fail-closed empty-set (`authz.ts:132`) + status column + audit.
- **Semantic contract break** (§4.5) can surprise external consumers if only additively published.
- **Codex adversarial pass owed** before implementation lock (this revision is 2-peer Opus only).
