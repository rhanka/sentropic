# SPEC DECISION — MCP Capability Registry Residence (P5)

> **DRAFT for architect + BR-70 owner decision — not ratified.**
> This document frames REVERSIBLE OPTIONS for the parked irreversible decision
> **P5** (`SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md §13.1`): *where the MCP
> capability registry physically lives (control-plane vs Resource-Plane; published
> package vs internal) and how it is exposed*. It does NOT pick the answer; it
> enumerates options + tradeoffs and proposes a recommendation for the architect
> (`claude:architect`) and the BR-70 owner to ratify. Authored by the
> `feat/mcp-registry-residence-options` planning lane (read-only grounding; no code).

## 0. Lineage and ownership

- Parent spec: `spec/SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md` — §8 (registry /
  AgentRuntimeLoop / DurableCall integration), §7 (STP multiplexer / discovery),
  §2.1 (core owns "capability registration and registry projection";
  *"registry initially incubated in API/control-plane or resource-plane until a
  second real package consumer appears"*; *"Avoid creating `mcp-registry` … by
  architecture desire alone; extraction follows real consumption"*), §1.1
  de-duplication map (`mcp-registry` residence → OWNED-ELSEWHERE, *joint BR-70
  owner, parked P5*), §13.1 (P5 = IRREVERSIBLE / owner-gated).
- Adjacent specs: `spec/SPEC_EVOL_CATALOG.md` (BR-42b unified capability catalog),
  `spec/SPEC_EVOL_RESOURCE_FS.md` (BR-70 / ARCH-21 Resource Plane; RF7 ownership
  correction 2026-06-11), `spec/SPEC_EVOL_DATA_ARCHITECTURE.md` (ARCH-19
  object-type registry).
- Ownership: P5 is a **joint architect + BR-70-owner** decision. The RF7 ownership
  correction (2026-06-11, `SPEC_EVOL_RESOURCE_FS.md §8`) already established that
  the MCP `resources/list`+`read` MAPPING and the `CatalogSource→ResourceProvider`
  adapter are **CATALOG lineage** (BR-42i / BR-42j, WP-CATALOG), and the Resource
  Plane only PROJECTS them. P5 must be decided consistently with that boundary
  (see §7 Q2).

## 1. The decision (scoped precisely)

The "MCP capability registry" in question is the store + projection that holds the
**provider manifests** an app/connector publishes per
`SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM.md §4` (`AppMcpProviderManifest` =
`resources[] / tools[] / prompts[]` + authz/audit/durability/secrets), and that
feeds the §8 flow:

```
provider manifest -> registry projection -> surface policy / visibility filtering
  -> AgentRuntimeLoop or MCP transport invocation -> DurableCall -> audit
```

P5 must decide, concretely:

1. **Physical residence** of the authoritative manifest/capability record:
   control-plane DB vs Resource-Plane (projection only) vs hybrid.
2. **Exposure**: how MCP manifests register/resolve, and how the Sentropic
   surfaces (chat, VSCode, `stp`) discover them — authz-projected with
   deny-as-missing (`§7.1`).
3. **Packaging / wire-shape home**: where the manifest/capability wire shapes
   (`AppMcpProviderManifest` etc.) live is an EXPLICIT open decision, NOT settled:
   (a) api-local row types, (b) the existing PRIVATE `@sentropic/mcp-platform`
   scaffold (which already declares them in code — see §1.1), or (c) a future
   PUBLISHED package. Activation/publication of any package overlaps P1 and is
   gated by `architecture.md` "activate by real consumption". This is NOT
   `@sentropic/ubo-contracts` territory (that package is the object-type registry's
   DATA wire-shape home, not the MCP contract home).

### 1.1 What already exists (VERIFIED against `origin/main`, post PR #371)

Two distinct "registries" exist today; neither is the MCP-manifest registry P5
asks for, but BOTH constrain the answer:

- **The capability catalog (BR-42b)** — `api/src/services/catalog/`:
  - `CatalogSource` (`source.ts`): `{ id, kind: 'static'|'mcp'|'marketplace',
    snapshot(): ReadonlyArray<CatalogEntry> (SYNC, hot-path), refresh?(): Promise,
    health?() }`. The live per-turn resolve is **synchronous**, so sources expose
    a sync `snapshot()`; remote sources repopulate it out-of-band via async
    `refresh()`.
  - `CompositeCatalogRegistry` (`composite-registry.ts`): in-memory, fans
    `list/get/search` across source snapshots, foundation-precedence collision.
    It is **UNSCOPED** (no authz on `list/search`).
  - `CatalogEntry` (`types.ts`): tagged union `skill | tool | agent | workflow |
    canvas`. Sources: `static-source`, `mcp-source`, `standalone-tool-source`,
    `agent-template-source`, `workflow-seed-source`, `canvas-template-source`.
  - `McpCatalogSource` (`sources/mcp-source.ts`): connects via
    `@modelcontextprotocol/sdk`, runs `tools/list`, maps **tools only** (NO
    `resources/list`, NO `prompts/list`) to `tool`-kind entries; sanitized
    public name + `rawName`; per-source config out-of-band; **default-OFF**
    (empty snapshot unless explicitly wired). Snapshot is **in-memory**, lost on
    process restart; refresh re-derives ids (collision suffix `_2`, NOT
    refresh-stable).
  - It is **app-local in `api/`, NOT a package** (D-PKG: `@sentropic/catalog`
    extraction DEFERRED).
- **The object-type registry (BR-59 / ARCH-19)** —
  `api/src/services/object-registry/object-type-registry.ts`:
  - The existing **control-plane DB** registry pattern: table
    `control.object_type_definitions` (`api/src/db/control-schema.ts`), port
    `ObjectTypeRegistry` with `register / get / list / update / deprecate`,
    **validate-on-write**, **anti-pollution caps** (`MAX_TYPES_PER_SCOPE=500`,
    `MAX_QUERYABLE_FIELDS=100`, `MAX_TYPED_REFERENCES=100`), `schemaVersion` +
    `status: draft|active|deprecated` lifecycle, **tenant-scoped** (`tenantId`
    nullable = global). Wire shapes come from the PRIVATE
    `@sentropic/ubo-contracts` package.
  - This is for **DATA object types**, NOT capabilities — but it is the canonical
    "durable, validated, capped, tenant-scoped control-plane registry" pattern P5
    would reuse.
- **The Resource Plane (BR-70 / ARCH-21a)** —
  `api/src/services/resource-plane/`:
  - `ResourceProvider` port (`contract.ts`): `list/stat/read/grep/edit/invoke/
    resolvePath` over a subtree; typed error envelope (`not_found =
    deny-as-missing`, `denied`, `unsupported`, …); `ResourceRef` +
    `ScopeMap`; `ResourceProviderBase` defaults unimplemented verbs to
    `unsupported`.
  - `CatalogResourceProvider` (`providers/catalog-provider.ts`) **ALREADY**
    projects the BR-42b catalog onto `/tools /skills /agents /workflows /canvas`,
    **authz-projected with deny-as-missing for `list/stat/read/grep`**
    (`authz.catalogAccess(...).discover`), read-only (`edit` denied, `invoke`
    `unsupported` in this slice). It enumerates per-`(kind, sourceId)` from each
    source `snapshot()` and CONSUMES the catalog registry — it does NOT own it.
  - **GAP (C4)**: `resolvePath`/`resolveAlias`/`collectionRef`
    (`catalog-provider.ts`) and `ResourceDispatcher.resolvePath` (`dispatcher.ts`)
    resolve a path alias to a ref by SNAPSHOT MATCH **without applying the
    `discover` authz gate** — alias resolution is not yet authz-projected, so it
    needs hardening (or a `stat`/`read` gate before any ref is acted on) before it
    is safe to expose.
  - Wired in `index.ts`; app-local in `api/`.
- **The private MCP provider-platform scaffold (`@sentropic/mcp-platform`)** —
  `packages/mcp-platform/` (present on this branch; PRIVATE, unpublished):
  - `"private": true`, `version 0.0.0`, NOT in any publish filter / root lockfile /
    trusted-publisher config; a MOCK-ONLY scaffold of
    `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM` slices 1+2+3+7 (no real DB/driver/network).
  - **ALREADY declares the MCP manifest/capability WIRE SHAPES in code**
    (`src/manifest.ts`: `AppMcpProviderManifest`, `CapabilityResource|Tool|Prompt`,
    `ConnectorSecretRequirement`, `ElicitationPolicy`) and the adapter contract
    (`src/runtime.ts`: `AppConnectorProviderAdapter`). These ARE the MCP wire
    shapes — they live HERE, **not** in `@sentropic/ubo-contracts` (which is the
    object-type registry's DATA wire-shape home).
  - **ALREADY models the §6.3/§6.4/§5.1 RUNTIME state as SEPARATE typed,
    restart-safe stores** (`src/stores.ts`: `PersistentSessionStore`,
    `PersistentConsentStore`, `PersistentEnrollmentStore`,
    `PersistentSecretStatusStore`, `PersistentElicitationStore`) over a generic
    `RecordStore` (`MemoryRecordStore` | `FileRecordStore`), fail-closed,
    status-only secrets. Crucially these runtime stores are modeled SEPARATELY from
    any manifest/capability registry — a manifest store and these state stores are
    distinct concerns (C3; see §6 Q5).
  - `docs/ADOPTION_GUIDE.md` and spec §13.1 keep package activation/publication and
    `mcp-registry` residence **owner/architect-gated** (P1 + P5).

**Consequence**: the catalog→resource-plane projection pattern (authoritative
capability list in the catalog, authz-projected read via a `ResourceProvider`) is
already SHIPPED for `list/stat/read/grep` on the 5 catalog kinds. It is NOT yet
complete: path/alias resolution (`resolvePath`/`resolveAlias`) returns refs by
snapshot match WITHOUT the `discover` gate, so it still needs hardening (or a
`stat`/`read` gate before any ref is acted on) before exposure (C4). P5 is largely
the question of whether the MCP-manifest registry adopts that same two-layer split,
and what the authoritative layer is made of (code-owned manifest vs in-memory
snapshot vs durable DB), plus the packaging gate.

## 2. Options

Four real options given the codebase, plus the status-quo baseline they build on.

**Baseline (status quo, B0)** — the MCP capability state lives ONLY in the
in-memory BR-42b catalog (`McpCatalogSource` snapshot), projected read-only by
`CatalogResourceProvider`. This works for *tools discovery* but has **no durable
authoritative record** of which providers/connectors are enrolled, their manifest
version, or consent/enrollment state — which `SPEC_EVOL_APP_MCP_PROVIDER_PLATFORM
§6.2/§6.3` REQUIRES to be **restart-safe and persisted, never an in-memory map**.
B0 alone therefore cannot satisfy the platform; every option below adds durability
or accepts the gap explicitly.

### Option A — Control-plane DB registry (authoritative store in the app control-plane)

- **What it is**: a dedicated control-plane DB home for MCP provider manifests +
  capability descriptors, modeled on the BR-59 `object_type_definitions` pattern.
  A new table (e.g. `control.mcp_provider_manifests`, optionally a child
  `control.mcp_capabilities`) with register/get/list/update/deprecate, validate-
  on-write, anti-pollution caps, `version` + `status` lifecycle, scope-bound by
  `ScopeMap`/tenant (DD10). It is the single source of truth.
- **Register/resolve**: an app/connector PUBLISHES its `AppMcpProviderManifest`
  by writing rows (validated). Resolution = DB query (manifest by id /
  `(scope, providerId)` composite, restart-safe per §6.3). The live MCP
  `tools/list`/`resources/list` snapshot is reconciled INTO the store on
  refresh/enrollment, not held only in memory.
- **Discovery (chat/VSCode/stp)**: an app service reads the DB and authz-projects
  the result (deny-as-missing, §7.1). The BR-70 Resource Plane projects the SAME
  store via a NEW `ResourceProvider` (mirroring `CatalogResourceProvider`); STP
  multiplexer (§7) reads the same service.
- **Publish vs internal**: stays INTERNAL/app-local. MCP wire shapes already live
  in the PRIVATE `@sentropic/mcp-platform` scaffold (NOT `@sentropic/ubo-contracts`,
  which is the object-type registry's DATA home). No published
  `@sentropic/mcp-registry` package until a real 2nd consumer (architecture
  activate-by-consumption + §2.1).
- **Migration from BR-59/BR-42b**: reuses the BR-59 *pattern* (not the
  `object_type_definitions` table — different concern); the BR-42b
  `McpCatalogSource` becomes a *feeder/reconciler* into the store rather than the
  source of truth. One Drizzle migration.
- **Coupling to BR-70**: LOW — BR-70 is a read projection consumer, exactly like
  the existing `CatalogResourceProvider`. The store can ship without BR-70.
- **Reversibility**: MEDIUM — a real control-plane table/migration for the manifest
  store **IS the residence commitment** (C2 / §5), not a freely removable slice;
  only an interface/mock prototype is reversible-now. The durable name + cross-plane
  published contract stay gated (§6).

### Option B — Resource-Plane projection only (registry-as-provider, no separate store)

- **What it is**: NO new authoritative store. The "registry" IS a
  `ResourceProvider` over BR-70: manifests are **projected/virtual**, derived live
  from connected MCP sources (the `McpCatalogSource` snapshot pattern, refreshed
  out-of-band). "Registry" = the projection/listing/`/mcp/<server>/…` surface.
- **Register/resolve**: a manifest "registers" by configuring an MCP source
  (out-of-band config); resolution = the in-memory snapshot, projected on read.
- **Discovery**: directly through the resource-plane verbs (`ls /mcp/<server>/
  tools`, `read …`). NOTE (C5): deny-as-missing is **not free** here —
  `provider-base.ts` only defaults verbs to `unsupported`, and the only implemented
  authz projector (`authz.ts` `ResourceAuthzProjector.catalogAccess`, which takes
  `CatalogEntryMetadata`) is **catalog-SPECIFIC**. Option B reuses the
  `CatalogResourceProvider` PATTERN, but an MCP-specific authz projector + provider
  STILL must be built. STP reads the same plane.
- **Publish vs internal**: app-local; nothing new to publish (the provider lives
  in `api/`); no durable-name commitment.
- **Migration**: minimal — extend `McpCatalogSource` to map `resources`/`prompts`
  (BR-42i) and add an `McpRegistryResourceProvider`; mostly additive over what
  exists.
- **Coupling to BR-70**: HIGH — the registry IS a BR-70 deliverable; there is no
  registry without the plane.
- **Reversibility**: HIGH structurally, BUT it **does not durably persist**
  enrollment/consent/manifest-version (`§6.2/§6.3` restart-safe requirement) — a
  pure-B registry would re-derive everything from live MCP connections on restart
  and cannot bind durable consent grants. So B is reversible-but-insufficient for
  the platform's stated persistence requirement unless paired with A's store
  (= Option C).

### Option C — Hybrid (authoritative control-plane store + Resource-Plane / STP projection)

- **What it is**: A's durable control-plane manifest/capability store as the
  **source of truth** for *which providers are registered and their manifest
  version* (the manifest registry), PLUS a **SEPARATE** durable persistence for the
  `§6.2/§6.3` RUNTIME state (MCP sessions, consent grants, connector enrollments) —
  these need NOT live in the same store (C3): the private `@sentropic/mcp-platform`
  scaffold already models them as DISTINCT `src/stores.ts` ports, and consent /
  enrollment may be an auth-lane store (Q5). PLUS B's Resource-Plane projection +
  STP discovery as the **read/visibility layer** that may JOIN across both stores,
  with the live MCP `tools/list`/`resources/list` snapshot filling capability
  detail. This is the §8 flow literally (manifest → registry projection →
  visibility filtering → invocation) and mirrors the SHIPPED catalog (authoritative
  list) ↔ `CatalogResourceProvider` (authz-projected read) split.
- **Register/resolve**: publish manifest = write to the control-plane store
  (validated, versioned); capability detail reconciled from the live MCP snapshot;
  resolve = store query + snapshot overlay.
- **Discovery**: BR-70 `ResourceProvider` + STP multiplexer both PROJECT the
  store read-only, authz-projected deny-as-missing. Single canonical visibility
  state set (`§7.1` `ConnectorVisibilityState`) rendered identically across chat /
  VSCode / `stp`.
- **Publish vs internal**: internal/app-local now; package extraction DEFERRED to
  a real 2nd consumer (P1 / architecture rule).
- **Migration**: A's migration + B's provider; `McpCatalogSource` becomes the
  reconciler feeding the store.
- **Coupling to BR-70**: MEDIUM — the authoritative store is plane-independent
  (catalog-lineage per RF7), BR-70 is one projection consumer (the primary LLM/UX
  surface). Clean ownership seam.
- **Reversibility**: MEDIUM — the manifest-store migration **IS the residence
  commitment** (C2); only the projection/reconciler and the separate runtime stores
  are freely additive. Irreversible commitments = the manifest migration itself +
  publication + cross-plane published contract (§6), all gated.

### Option D — Code-owned manifests (private scaffold) + separate durable runtime stores + projection

- **What it is**: NO control-plane manifest DB table. The manifest/capability
  registry is **code-owned**: manifests are declared in the
  `@sentropic/mcp-platform` adapter (`AppMcpProviderManifest`, `src/manifest.ts`),
  versioned by code/package version rather than DB rows. The `§6.2/§6.3` RUNTIME
  state (sessions, consent grants, connector enrollments) **IS** durably persisted,
  in the SEPARATE typed stores the scaffold already models (`src/stores.ts`, over a
  restart-safe `RecordStore`). Discovery is a Resource-Plane / STP projection over
  the code-owned manifests + the durable runtime state.
- **Register/resolve**: a provider "registers" by shipping its adapter manifest in
  code; resolve = read the in-code manifest + the durable enrollment/consent state;
  capability detail reconciled from the live MCP snapshot.
- **Discovery**: an MCP-specific `ResourceProvider` projects manifests + runtime
  state, authz-projected deny-as-missing (the MCP projector must be built, per C5).
  STP reads the same plane.
- **Publish vs internal**: the scaffold stays PRIVATE and UNACTIVATED;
  "activate / publish the package now" is explicitly DEFERRED (owner-gated P1, per
  `packages/mcp-platform/docs/ADOPTION_GUIDE.md`).
- **Migration**: lowest — extend the existing private scaffold (manifest types +
  the separate durable stores) + add one MCP projection provider. **NO production
  migration, so it does NOT pre-commit P5's residence.**
- **Coupling to BR-70**: MEDIUM — manifests are plane-independent (code-owned);
  BR-70 is one projection consumer.
- **Reversibility**: HIGHEST — no manifest DB table means no residence commitment
  to undo (C2); only package activation/publication stays gated.

## 3. Comparison

| Criterion | A — Control-plane DB | B — Resource-Plane projection only | C — Hybrid (store + projection) | D — Code-owned + separate durable stores |
|---|---|---|---|---|
| Fits existing BR-59 pattern | **High** (reuses object-type-registry shape) | Low (no durable store) | **High** (manifest store = BR-59 shape) | Low (no manifest DB table; reuses scaffold store pattern for runtime state) |
| Fits existing BR-70 pattern | Medium (BR-70 = one consumer) | **High** (registry IS a provider) | **High** (mirrors catalog↔CatalogResourceProvider) | **High** (projection consumer) |
| Authoritative-source clarity | **High** (DB = single truth) | **Low** (snapshot, no truth of enrollment/consent) | **High** (manifest DB + SEPARATE runtime stores, clear seam) | Medium (manifest = code/package version; runtime = durable stores) |
| Restart-safe persistence (§6.2/§6.3) | **Yes** | **No** (in-memory snapshot) | **Yes** | **Yes** (runtime stores durable; manifests code-pinned) |
| Discovery / surface parity (§7.1) | Yes (service + provider) | Yes (native plane) | **Yes** (one read layer, all surfaces project it) | Yes (projection) |
| Publish / versioning blast-radius | Low if internal (PRIVATE contracts) | **Lowest** (nothing to publish) | Low if internal; deferred publish | **Lowest** (scaffold stays private/unactivated) |
| MCP resources/prompts coverage | Needs explicit modeling (additive) | Needs BR-42i mapping (additive) | Needs both (additive) | **Native** (manifest already models resources/tools/prompts) |
| Effort | Medium (migration + service + provider) | **Low** (extend source + 1 provider) | Medium-High (A + B) | Low-Medium (extend scaffold + projection) |
| Reversibility (internal build) | Medium (a real migration IS a residence commitment — C2/§5) | **High** | Medium (manifest migration = commitment) | **Highest** (no manifest DB table) |
| Reversibility (the P5 commitment) | Gated (residence + name/contract) | Gated (contract) | Gated (residence + name/contract) | Gated (package activation only) |

## 4. Recommendation (PROPOSAL — architect + BR-70 owner to ratify)

**Proposed: Option C (Hybrid) as the TARGET — internal v0, NO package
activation/publication, the control-plane manifest store created ONLY after P5
ratification, projected through the Resource-Plane / STP, with SEPARATE restart-safe
auth/session/enrollment persistence.** Until P5 is ratified, the reversible-now
path is **Option D** (extend the private `@sentropic/mcp-platform` scaffold + its
separate durable stores; NO production migration). Rationale:

1. C gives a durable, validated, versioned manifest/capability registry AND
   satisfies the `§6.2/§6.3` restart-safe persistence requirement for
   sessions/consent/enrollment — kept in a **SEPARATE** restart-safe store (C3; the
   scaffold already models these distinctly), not folded into the manifest store.
   It keeps the `§7.1` authz-projected deny-as-missing discovery, which an
   MCP-specific projector must still build (the shipped projector is
   catalog-specific — C5).
2. It **reuses two patterns the repo already proves**: the BR-59
   `object_type_definitions` durable-validated-capped-scoped registry for the
   authoritative manifest store, and the catalog↔`CatalogResourceProvider`
   two-layer split for the projection (whose alias-resolution authz gap must be
   closed first — C4). Net-new surface area is minimized.
3. It respects the **RF7 ownership boundary** (catalog lineage owns the MCP
   manifest/mapping; BR-70 projects) — the manifest store is plane-independent, so
   BR-70 and the registry can evolve on separate cadences.
4. It keeps the **irreversible bits parked**: a real control-plane Drizzle
   migration/table for the manifest store **IS the residence commitment** (C2), so
   it is NOT built until P5 ratifies; nothing is published, no durable public name
   is minted, no cross-repo contract is frozen. The MCP wire shapes already live in
   the PRIVATE `@sentropic/mcp-platform` scaffold (NOT `@sentropic/ubo-contracts`,
   which is the object-type registry's DATA home), so the public-API blast-radius is
   zero until a real 2nd consumer triggers extraction (architecture
   activate-by-consumption + P1).

Option B alone is rejected: it cannot durably bind consent/enrollment and would
lie under restart. Option A alone is acceptable but leaves the projection
under-specified. **Option D is the safe REVERSIBLE-NOW slice** (no residence
commitment) and may even be the destination if the architect prefers code-owned
manifests over a DB table; C = A's manifest store + D's separate durable runtime
stores + B's projection, which is the §8 flow as written.

This is a PROPOSAL only. The architect + BR-70 owner ratify; until then P5 stays
parked and no build slice may pre-empt it — and per C2 the control-plane manifest
migration/table is itself part of the parked decision.

## 5. Reversible vs irreversible split

**Reversible / additive — can be designed and built now (does NOT decide P5):**
These are **interface / prototype / mock-only** — NOT a production migration.

- Extending the PRIVATE `@sentropic/mcp-platform` scaffold: manifest + capability
  types, the adapter, and the SEPARATE durable runtime stores it already models
  (`src/stores.ts` session/consent/enrollment/secret-status/elicitation), backed by
  `MemoryRecordStore`/`FileRecordStore`. No production DB, no migration. The MCP
  wire shapes already live here (NOT in `@sentropic/ubo-contracts`).
- A prototype `McpRegistryResourceProvider` (mock-backed) projecting the scaffold's
  manifests + runtime state into BR-70 mounts (e.g. `/mcp/<server>/…`), mirroring
  `CatalogResourceProvider` — INCLUDING a NEW MCP-specific authz projector (the
  shipped projector is catalog-specific — C5).
- Closing the `CatalogResourceProvider`/`ResourceDispatcher` alias-resolution authz
  gap (C4) so the projection pattern is safe to mirror.
- Extending `McpCatalogSource` to map `resources`/`prompts` (BR-42i) as a
  feeder/reconciler — additive over what exists.

**Irreversible — the P5 commitment, stays architect + BR-70-owner gated:**

- **A real control-plane Drizzle migration / table / service** for the MCP manifest
  registry (e.g. `control.mcp_provider_manifests`): creating it **IS the residence
  commitment** (C2) — it picks the durable storage location and the manifest store's
  ownership. It is NOT a "reversible now" slice.
- **Committing the durable storage location** as ratified architecture
  (control-plane ownership of the manifest store) — and with it the **ownership
  boundary** (catalog-lineage store vs BR-70 deliverable; consistent with RF7).
- **Activation / publication** of a package: durable npm name, public API
  stability, trusted-publisher setup, compat matrix, and adding the package to the
  root lockfile (= activation) (overlaps P1; `§13.1` / ADOPTION_GUIDE).
- **Freezing the cross-plane contract** as a published surface other repos/hosts
  depend on (the `ResourceRef`/manifest schema, the registry↔plane boundary, and
  the wire-shape home choice among api-local / `@sentropic/mcp-platform` / a
  published package).
- **Persistence model for consent/enrollment** as a memorialized contract
  (`§6.3` records), which downstream auth/consent flows will pin — whether or not it
  shares the manifest store's DB (Q5).

The reversible slice can proceed under the catalog/BR-70 lanes WITHOUT resolving
P5, provided it stays interface/prototype/mock (private scaffold, no production
migration, no published name, no frozen cross-repo contract). The moment any of the
irreversible bullets is touched — **including the control-plane manifest
migration** — the gate applies.

## 6. Open questions for architect + BR-70 owner

1. **Q1 — Authoritative manifest shape**: code-owned manifests in the private
   `@sentropic/mcp-platform` scaffold (Option D, no DB) vs a new dedicated
   `control.mcp_provider_manifests` table vs reuse/extend `object_type_definitions`?
   (Assumption: code-owned now; a NEW table later only if/when P5 ratifies a DB
   residence — capabilities ≠ data object types, reusing the BR-59 *pattern* not the
   table.)
2. **Q2 — Ownership**: is the MCP-manifest registry STORE a catalog-lineage
   deliverable (consistent with RF7 making the MCP mapping BR-42i and the adapter
   BR-42j) with BR-70 as projection consumer, or a BR-70-owned deliverable? This
   determines which lane builds the reversible slice.
3. **Q3 — resources/prompts modeling**: `McpCatalogSource` maps **tools only**
   today. Do MCP `resources`/`prompts` become new `CatalogEntryKind`s, a separate
   manifest sub-model, or live only in the new registry store? (BR-42i scope.)
4. **Q4 — Publish gate timing (P1 overlap)**: under what trigger does
   `@sentropic/mcp-registry` become a real package? (Default: only on a real 2nd
   consumer, per `architecture.md` + §2.1; until then internal.)
5. **Q5 — Consent/enrollment persistence**: do the `§6.3`
   session/consent/enrollment records share the manifest store's control-plane DB,
   or live in a separate auth-lane store? (Affects A/C store scope.)
6. **Q6 — Scope binding**: confirm the manifest store uses the BR-70 `ScopeMap` /
   DD10 binding (Sentropic = `{tenantId, workspaceId}`) and the object-type-
   registry `tenantId`-nullable=global convention, so the projection's authz
   surface aligns across catalog, resource-plane and registry.

---

*End — DRAFT for architect + BR-70 owner decision — not ratified.*
