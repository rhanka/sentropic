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
3. **Packaging**: published `@sentropic/mcp-registry` vs internal/app-local code
   (overlaps P1; gated by `architecture.md` "activate by real consumption").

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
    **authz-projected with deny-as-missing** (`authz.catalogAccess(...).discover`),
    read-only (`edit` denied, `invoke` `unsupported` in this slice). It enumerates
    per-`(kind, sourceId)` from each source `snapshot()` and CONSUMES the catalog
    registry — it does NOT own it.
  - Wired in `index.ts`; app-local in `api/`.

**Consequence**: the catalog→resource-plane projection pattern (authoritative
capability list in the catalog, authz-projected read via a `ResourceProvider`) is
already SHIPPED for the 5 catalog kinds. P5 is largely the question of whether the
MCP-manifest registry adopts that same two-layer split, and what the authoritative
layer is made of (in-memory snapshot vs durable DB), plus the packaging gate.

## 2. Options

Three real options given the codebase, plus the status-quo baseline they build on.

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
- **Publish vs internal**: stays INTERNAL/app-local (like
  object-type-registry, whose wire shapes are the PRIVATE `@sentropic/ubo-
  contracts`). No published `@sentropic/mcp-registry` until a real 2nd consumer
  (architecture activate-by-consumption + §2.1).
- **Migration from BR-59/BR-42b**: reuses the BR-59 *pattern* (not the
  `object_type_definitions` table — different concern); the BR-42b
  `McpCatalogSource` becomes a *feeder/reconciler* into the store rather than the
  source of truth. One Drizzle migration.
- **Coupling to BR-70**: LOW — BR-70 is a read projection consumer, exactly like
  the existing `CatalogResourceProvider`. The store can ship without BR-70.
- **Reversibility**: HIGH for the internal store (additive table + service +
  provider, all removable); the *durable name + cross-plane published contract*
  is the irreversible part and stays gated (§6).

### Option B — Resource-Plane projection only (registry-as-provider, no separate store)

- **What it is**: NO new authoritative store. The "registry" IS a
  `ResourceProvider` over BR-70: manifests are **projected/virtual**, derived live
  from connected MCP sources (the `McpCatalogSource` snapshot pattern, refreshed
  out-of-band). "Registry" = the projection/listing/`/mcp/<server>/…` surface.
- **Register/resolve**: a manifest "registers" by configuring an MCP source
  (out-of-band config); resolution = the in-memory snapshot, projected on read.
- **Discovery**: directly through the resource-plane verbs (`ls /mcp/<server>/
  tools`, `read …`), authz-projected NATIVELY (the deny-as-missing projector
  already exists in `authz.ts`/`provider-base.ts`). STP reads the same plane.
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

- **What it is**: A's durable control-plane store as the **source of truth** for
  *which providers/connectors are enrolled, their manifest version, and
  consent/grant/enrollment state* (`§6.3` records), PLUS B's Resource-Plane
  projection + STP discovery as the **read/visibility layer**, with the live MCP
  `tools/list`/`resources/list` snapshot filling capability detail. This is the
  §8 flow literally (manifest → registry projection → visibility filtering →
  invocation) and mirrors the SHIPPED catalog (authoritative list) ↔
  `CatalogResourceProvider` (authz-projected read) split.
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
- **Reversibility**: HIGH for the build (store + provider + reconciler all
  additive); irreversible commitment = publication + cross-plane published
  contract (§6), gated.

## 3. Comparison

| Criterion | A — Control-plane DB | B — Resource-Plane projection only | C — Hybrid (store + projection) |
|---|---|---|---|
| Fits existing BR-59 pattern | **High** (reuses object-type-registry shape) | Low (no durable store) | **High** (store = BR-59 shape) |
| Fits existing BR-70 pattern | Medium (BR-70 = one consumer) | **High** (registry IS a provider) | **High** (mirrors catalog↔CatalogResourceProvider) |
| Authoritative-source clarity | **High** (DB = single truth) | **Low** (snapshot, no truth of enrollment/consent) | **High** (DB truth + snapshot detail, clear seam) |
| Restart-safe persistence (§6.2/§6.3) | **Yes** | **No** (in-memory snapshot) | **Yes** |
| Discovery / surface parity (§7.1) | Yes (service + provider) | Yes (native plane) | **Yes** (one store, all surfaces project it) |
| Publish / versioning blast-radius | Low if internal (PRIVATE contracts) | **Lowest** (nothing to publish) | Low if internal; deferred publish |
| MCP resources/prompts coverage | Needs explicit modeling (additive) | Needs BR-42i mapping (additive) | Needs both (additive) |
| Effort | Medium (migration + service + provider) | **Low** (extend source + 1 provider) | Medium-High (A + B) |
| Reversibility (internal build) | **High** | **High** | **High** |
| Reversibility (the P5 commitment) | Gated (name/contract) | Gated (contract) | Gated (name/contract) |

## 4. Recommendation (PROPOSAL — architect + BR-70 owner to ratify)

**Proposed: Option C (Hybrid), internal/app-local for v0, package publication
deferred.** Rationale:

1. It is the only option that satisfies the platform's **restart-safe persistence**
   requirement (`§6.2/§6.3`: sessions/consent/enrollment "MUST be resolved from
   persisted state, never an in-memory map") while keeping the **authz-projected,
   deny-as-missing discovery** (`§7.1`) that BR-70 already implements.
2. It **reuses two patterns the repo already proves**: the BR-59
   `object_type_definitions` durable-validated-capped-scoped registry for the
   authoritative store, and the catalog↔`CatalogResourceProvider` two-layer split
   for the projection. Net-new surface area is minimized.
3. It respects the **RF7 ownership boundary** (catalog lineage owns the MCP
   manifest/mapping; BR-70 projects) — the store is plane-independent, so BR-70 and
   the registry can evolve on separate cadences.
4. It keeps the **irreversible bits parked**: nothing is published, no durable
   public name is minted, no cross-repo contract is frozen in v0. The store wire
   shapes go in the PRIVATE `@sentropic/ubo-contracts` (as object-type-registry
   already does), so the public-API blast-radius is zero until a real 2nd consumer
   triggers extraction (architecture activate-by-consumption + P1).

Option B alone is rejected: it cannot durably bind consent/enrollment and would
lie under restart. Option A alone is acceptable but leaves the projection
under-specified; C = A's store + B's projection, which is the §8 flow as written.

This is a PROPOSAL only. The architect + BR-70 owner ratify; until then P5 stays
parked and no build slice may pre-empt it.

## 5. Reversible vs irreversible split

**Reversible / additive — can be designed and built now (does NOT decide P5):**

- A new control-plane DB table for MCP provider manifests (one Drizzle migration),
  modeled on `object_type_definitions` (validate-on-write, caps, version/status,
  scope-bound). Removable/reshapeable.
- An app-local registry service (`register/get/list/update/deprecate`,
  reconcile-from-snapshot), internal to `api/`.
- A new `McpRegistryResourceProvider` projecting the store into BR-70 mounts
  (e.g. `/mcp/<server>/…`), mirroring `CatalogResourceProvider` (authz-projected,
  deny-as-missing, read-only).
- Extending `McpCatalogSource` to map `resources`/`prompts` (BR-42i) and feed the
  store as a reconciler.
- Wire shapes kept in the PRIVATE `@sentropic/ubo-contracts` (no public surface).

**Irreversible — the P5 commitment, stays architect + BR-70-owner gated:**

- **Publication** of a `@sentropic/mcp-registry` package: durable npm name, public
  API stability, trusted-publisher setup, compat matrix (overlaps P1; `§13.1`).
- **Freezing the cross-plane contract** as a published surface other repos/hosts
  depend on (the `ResourceRef`/manifest schema, the registry↔plane boundary).
- **Committing the durable storage location** as ratified architecture
  (control-plane ownership of the manifest store) — and with it the
  **ownership boundary** (catalog-lineage store vs BR-70 deliverable; consistent
  with RF7).
- **Persistence model for consent/enrollment** as a memorialized contract
  (`§6.3` records), which downstream auth/consent flows will pin.

The reversible slice can proceed under the catalog/BR-70 lanes WITHOUT resolving
P5, provided it stays internal (no published name, no frozen cross-repo contract).
The moment any of the irreversible bullets is touched, the gate applies.

## 6. Open questions for architect + BR-70 owner

1. **Q1 — Authoritative store shape**: new dedicated `mcp_provider_manifests`
   table vs reuse/extend `object_type_definitions`? (Assumption: a NEW table —
   capabilities ≠ data object types — reusing the BR-59 *pattern*, not the table.)
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
