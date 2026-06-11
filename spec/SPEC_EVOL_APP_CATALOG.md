# SPEC_EVOL — ARCH-01: App Control-Plane Model + Catalog Projection

> Wave-1 architecture study (ARCH-01, SPEC_EVOL_ARCHITECTURE.md:706). Output = this doc. Design via double consensus **Codex 5.5-xhigh + Fable 5 (both GO-WITH-CHANGES, 2026-06-11)**; all convergent must-fixes folded below. Produces the control-plane design + the D7 migration-cost estimate. NO code, NO `@sentropic/contracts` mutation (ARCH-12 gate), NO instance migration (D7 = estimate only). Two owner-irreversible decisions are surfaced in §6 for ratification BEFORE implementation.

## 0. Frame & ratified constraints (do NOT re-litigate)
- **D1=B** (arch:662): Tenant = org/account. IdP owns identity-tenants (`tenant_memberships`, BR-39e); product control plane owns **resource bindings** referencing them by ID. New code MUST NOT couple `tenantId` to `workspaceId`.
- **D2=B** (arch:663): App template = DB control-plane resource + a thin `CatalogSource` projection; in-memory catalog never the source of truth for apps.
- **D7=A** (arch:668): flagship surfaces become app templates (instances deferred); ARCH-01 produces a migration-cost estimate first.
- **D11=B / ARCH-12** (arch:672): no published-contract mutation before ARCH-12. The control-plane types here are **api-local** (not `@sentropic/contracts`) → no ARCH-12 gate triggered, but §3.1 namespace + DD discipline apply.
- **Data-architecture namespace rule (DD, data:168-176)**: new control-plane tables live in a **distinct Postgres `control` schema with its OWN migration stream**; **NO new cross-namespace foreign keys** (IDs only across the boundary); CHECK-constraint discipline on control enum-likes.
- Reversible defaults in force (arch:§6.4): build-cli embedded templates = first app-template source; project apps into `search_catalog` only after control-plane resources exist; `AppContextResolver` = Hono middleware; `/api/apps/:appSlug` kept (slug validated vs `Host`); Postgres outbox/projections before external event infra; public capability projection **deny-by-default** (arch:695).
- Concepts fixed (arch:§3.2): App template / App instance / Workspace / Tenant / Remote distinct; apps are NOT `workspace.type`.

## 1. Study question set
- **Q1** Control-plane residence & namespace.
- **Q2** Resource schema (`app_templates`, `app_instances`, bindings, hostnames).
- **Q3** build-cli manifest ↔ AppTemplate vocabulary.
- **Q4** Catalog projection mechanism.
- **Q5** D7 flagship retro-modeling migration-cost estimate.

## 2. Resolutions (consensus-corrected)

### Q1 — Residence & namespace → product Postgres, dedicated `control` schema + own migration stream
- Control-plane resources are **product-owned** (D1=B) and live in the **product Postgres** in a dedicated **`control` schema** (data:168). They get their **own migration stream**, separate from `api/drizzle/` — a study deliverable for the implementation branch (the current single-Drizzle-stream + one-migration-per-branch discipline must be extended with a `control`-schema migration channel; mechanism: a second Drizzle config/out dir scoped to `control`, applied in the same `run-migrations` boot order after `public`).
- **No cross-namespace FK**: `control.*` references `public.*` and the identity namespace by **ID only**, validated in resolver/service logic (orphan reconciliation is app-level; CASCADE unavailable).
- **Rationale (corrected)**: `tenants` (schema.ts:649) and `tenant_memberships` (schema.ts:664) live in the product Postgres TODAY (with a real FK `oauth_clients.tenantId → tenants.id`, schema.ts:252). The identity family is a THIRD namespace with a *planned* physical extraction (IdP Phase D, data:172-175). Soft-reference is therefore mandated by the **namespace rule + the Phase-D extraction plan**, NOT by current physical impossibility.
- F1 resolved: same-Postgres `control` schema (a separate physical DB now would violate the ARCH-10 single-Postgres self-host portability default, arch-data:154-155). Revisit only at ARCH-10/17.

### Q2 — Resource schema (CRD-like, relational where it must constrain; jsonb for vocabulary)
Blueprint stays `jsonb` for vocabulary evolution, but routing/isolation/lifecycle/identity fields are **promoted to typed columns with CHECK discipline** (data:175 — do not repeat the `workspace.type` text+zod-only pattern, schema.ts:17).
- **`control.app_templates`** (the versioned blueprint; published rows IMMUTABLE):
  - `id` (version-row id), `family_id` (stable app-family id — distinct from version-row id), `app_slug`, `version` (semver), `status` (`draft|published|deprecated`, CHECK), `blueprint jsonb`, `blueprint_schema_version` (DD8 mirror), timestamps.
  - **Unique `(app_slug, version)`** (NOT "per major" — append-only version rows). `family_id` groups versions.
  - **NO `desired_state`/`observed_state` here** — reconciliation state is not template state (a published template is immutable); it lives on instances/deployments.
- **`control.app_instances`** (template bound to tenant+env; reconciled):
  - `id`, `template_family_id`+`template_version` (the bound version), `tenant_id` (soft ref to IdP tenant), `environment` (`prod|preview|local`, CHECK), `status` (instance lifecycle: `provisioning|active|suspended|retired`, CHECK — a SEPARATE state machine from template `status`), `desired_state jsonb`, `observed_state jsonb`, timestamps.
- **`control.app_instance_hostnames`** (normalized — host-authoritative routing needs DB uniqueness, arch:227):
  - `hostname` (PRIMARY KEY / globally unique, canonicalized lower-case), `app_instance_id`. One hostname → exactly one instance (slug/Host mismatch = 404 is then DB-guaranteed).
- **`control.app_workspace_bindings`** (M:N workspace↔instance):
  - `id`, `app_instance_id` (id ref), `workspace_id` (**soft id ref** to `public.workspaces` — NO FK), `tenant_id` (denormalized for DD9 composite `(tenant_id, workspace_id)` isolation), `allowed_workspace_types text[]`, `default_workspace_template`, timestamps. Index `(tenant_id, workspace_id)`; pre-declare the ARCH-11 re-key posture for `tenant_id` (DD9 "re-key pending ARCH-11").

### Q3 — build-cli ↔ AppTemplate → blueprint is NET-NEW vocabulary; ScaffoldManifest is a referenced artifact (NOT a 1:1 map)
- **Correction**: the real build-cli export is `ScaffoldManifest = { entries: ManifestEntry{ sourcePath, outputPath, content, transforms?, mode? } }` (build-cli templating/types.ts:33-56) — a deterministic file-copy manifest with `{{token}}` markers; init tokens are only name/slug/provider/ports/repo/reply (init.ts:61). It carries **ZERO** app vocabulary (no auth mode, hostnames, route mounts, capabilities, bindings, quota class, visibility, deployment hints). A "1:1 field-map" maps zero fields.
- **Resolution**: `AppTemplateBlueprint` is the **canonical, net-new app metadata vocabulary** (arch:164-170 sections). The build-cli `ScaffoldManifest` is a **scaffold artifact referenced by** a blueprint (provenance: embedded template id + token map) for the "generated app" deployment-hint path — not the vocabulary itself. Satisfies arch:158-160 ("must not start a parallel vocabulary"): there is no pre-existing app vocabulary to fork; build-cli stays the scaffold/provenance source, the chat-app subtree already designed to lift into a standalone template package (chat-app.ts:9-10). **Where the canonical vocabulary type physically lives is an owner decision — see §6.**

### Q4 — Catalog projection → `AppCatalogSource` with refresh-materialized snapshot + outbox invalidation; explicit allow; tenant-filtered
- **Correction (F3)**: a `CatalogSource.snapshot()` MUST be synchronous and MUST NOT do I/O (catalog source.ts:32-51), so "reads-live per query" is **impossible** as a `CatalogSource`. Use an **out-of-band `refresh()`-repopulated in-memory snapshot** (the MCP source pattern, source.ts:53-57) invalidated by the ratified **Postgres outbox/NOTIFY** default (arch:688-689, owned by ARCH-14). Staleness bound = NOTIFY latency. (Alternative considered + rejected for now: async DB read-through at the `search_catalog` tool layer, outside the SPI — heavier, deferred.)
- **It IS a 6th catalog kind, mechanically** (stated plainly, not dodged): `CatalogEntryKind` is a closed union `skill|tool|agent|workflow|canvas` (types.ts:22) and every entry carries `kind`; an app projection adds `kind:'app'` + a new `CatalogSourceKind:'app'` (currently `static|mcp|marketplace`, source.ts:22). This is consistent with D2=B — what D2 rejected was the in-memory catalog as the **source of truth** for apps, not an `app` literal in the projection wire. These are api-local types → no ARCH-12 gate.
- **Projects TEMPLATES, not instances** (per §3.1 arch:154-157: the projection exposes discoverable app blueprints): project `app_templates` with `status=published`. (Divergence from the draft's instance-projection acknowledged; template projection matches the spec's "discoverable blueprints" intent and avoids per-instance churn.)
- **Deny-by-default (corrected)**: project ONLY templates with an **explicit allow** state (e.g. `policy.marketplaceVisibility ∈ {public, marketplace}`); a missing/unknown policy MUST NOT project (NOT `!= hidden`). Tenant scoping via `CatalogEntryMetadata.contextFilter`/`authzRequirements` (types.ts:45-47) so tenant-bound surfaces never leak cross-tenant into discovery (arch:695).

### Q5 — D7 migration-cost estimate (authoring + cutover risk, folded from the code-Explore)
Current flagship behavior is deeply keyed on `workspace.type` (enum `neutral|ai-priorities|opportunity|code`, schema.ts:17, indexed:23; create-time seeding workspaces.ts:98; workflow seeds flow workflows.ts:847; runtime selection todo-orchestration.ts:2340; view-template-service ~600 LOC of switches; 3 `default-agents-*.ts`; tables `workspace_type_workflows`/`view_templates`). **`neutral` is OUT of the retro-model blast radius** (no agents/workflows/type templates).

| Surface | Authoring (no instance move) | Cutover risk (later instance move) | Riskiest coupling |
|---|---|---|---|
| **ai-priorities** | **M** | **M** | View-template descriptors implicitly coupled to `TemplateRenderer` component format → lock a versioned descriptor schema at retro-model time |
| **opportunity** | **M→L** | **L** | bids/proposals routes import agent catalog directly (hardcoded) + initiative-template diverges from ai-priorities → needs decoupling + template-variant strategy |
| **code** | **S** | **S** | minimal (3 agents + 1 workflow; reuses common templates) |

- **Authoring total ≈ 6-8 days** (extract 3 agent catalogs + 4 workflows + view-template catalogs + AppContextResolver factory + decouple bids/proposals + lock descriptor versioning). **No DB migration / no instance move** — data stays in place; templates authored + projection wired only.
- **Cutover (deferred, separate plan)**: replacing the live `workspace.type` enum with app-template + binding resolution per workspace is the L-risk step; this estimate sizes it (above) but the detailed cutover plan is a named follow-up gated on ARCH-11 (real tenant) + this study's acceptance.

## 3. Forks resolved
- **F1** → product Postgres `control` schema (separate DB deferred to ARCH-10). ✔
- **F2** → blueprint `jsonb` + promoted relational columns (tenant/env/status/version) + normalized unique hostnames table + CHECK discipline. ✔
- **F3** → refresh-materialized snapshot + outbox/NOTIFY invalidation; app = mechanically a new `kind`. ✔
- **F4** → D7 estimate includes per-surface cutover risk, not authoring-only. ✔

## 4. Dependencies & non-goals
- **Unblocks** ARCH-02/03/04/05/10 (arch:735-762). **Folds/parallels** ARCH-11 (supplies real `tenantId`; this study pre-declares the re-key posture), ARCH-12 (gates contract mutations — none shipped here), ARCH-14 (audit/outbox residents share `control`; the projection's invalidation rides ARCH-14's outbox/NOTIFY).
- **Non-goals**: no contracts mutation; no instance migration; no public-auth/guest model (ARCH-02); no edge-proxy/deployment (ARCH-17); no canvas runtime (ARCH-16).

## 5. Acceptance
Q1-Q5 resolved with consensus-backed, code-grounded design; 4 control-schema tables sketched (templates/instances/hostnames/bindings) with namespace + isolation + CHECK + uniqueness discipline; blueprint = net-new vocabulary with build-cli scaffold as referenced artifact; projection = refresh+outbox-invalidated `AppCatalogSource` (kind:'app', deny-by-default, tenant-filtered); D7 estimate = authoring S/M/L + cutover risk per flagship. Forks F1-F4 resolved. The 2 owner-irreversible decisions (§6) ratified before the implementation branch. This doc becomes the ARCH-01 output; converted to a branch plan later.

## 6. Owner-irreversible decisions — RESOLVED (rhanka, 2026-06-11)
- **OD-1 = RESOLVED: keep `ai-priorities` / `opportunity` / `code`** as the public app_slugs (continuity; internal ids become public ids).
- **OD-2 = RESOLVED (reversible default adopted): api-local now**, extract a dedicated `@sentropic/app-template` package only when the marketplace/third-party story is real (ARCH-10/D10).
Original framing kept below for traceability.

- **OD-1 — Public `app_slug` names for the 3 retro-modeled flagships.** Slugs surface in `/api/apps/:appSlug` (arch:676) + hostnames; once instances/URLs circulate they calcify exactly like the D5 preview domain (a Wave-0 owner deliverable). Repo policy requires owner validation of durable names.
  - *Recommendation*: keep the existing internal identifiers as slugs for continuity — `ai-priorities`, `opportunity`, `code` — unless a public-facing rename is wanted (e.g. `priorities`/`opportunities`). Low engineering cost either way; the cost is naming-permanence.
- **OD-2 — Canonical app-template vocabulary package home.** `@sentropic/build-cli` is PUBLIC and exports `./manifest` types (package.json:14, index.ts:11). Where `AppTemplateBlueprint` (the net-new vocabulary) physically lives is a published-API/marketplace decision: (a) api-local only (no public contract; simplest; defers marketplace); (b) a NEW dedicated package `@sentropic/app-template` (clean public vocabulary, marketplace-ready, new publish lane); (c) fold into `@sentropic/build-cli` (couples the scaffolder to the control-plane vocabulary).
  - *Recommendation*: **(a) api-local for ARCH-01**, extract to **(b)** a dedicated `@sentropic/app-template` only when the marketplace/third-party-template story is real (ties to ARCH-10/D10, currently deferred). Avoids minting a durable public contract prematurely (respects the ARCH-12/D11 gate spirit).
