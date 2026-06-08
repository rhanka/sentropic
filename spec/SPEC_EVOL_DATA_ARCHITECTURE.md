# SPEC_EVOL_DATA_ARCHITECTURE — Data in the agentic era (Sentropic universe)

Status: deep-study v3, created 2026-06-07, hardened the same day by TWO
double adversarial rounds (round 1: concept review; round 2: decision-packet
audit — Codex 5.5 xhigh + Opus 4.8 each round, all four verdicts
GO-WITH-CHANGES). Companion to `spec/SPEC_EVOL_ARCHITECTURE.md` (merged PR
#268, decisions D1-D11). This study frames how Sentropic manages DATA across
five axes and registers as study ARCH-18, spawning ARCH-19 as the single
net-new sub-study.

Owner decisions DD1-DD11 were taken on 2026-06-07 (section 7); the ARCH-19
paper lots and the hardening prerequisite branch are dispatchable.

## 1. Purpose

Sentropic is becoming an app-foundry and productivity backplane where agents
create, transform, and reconcile data continuously. Today the structured data
lives in one Postgres instance behind hardcoded Drizzle tables (artifact BYTES
already live in S3-compatible storage), with free-form `jsonb` as the only
extension mechanism. That was the right way to ship one product; it is not a
data architecture for:

- a PaaS control plane governing tenants, apps, quotas, and audit (D1/D2/D6);
- universal business objects (opportunity, bid, solution, project, account...)
  shared across Sentropic apps AND independent builders such as OpenERP (B2B2B
  org B) — where the hypothesis that ~90% of a business app's objects can be
  expressed in a universal model is exactly that, a HYPOTHESIS to falsify;
- a knowledge layer where graphify reconciles named entities across
  workspaces, documents, chats, and business objects;
- agents that legitimately create AD-HOC data shapes at runtime (today: raw
  JSON in `.data` columns) and need a governed promotion path;
- a physical layer that must outgrow "everything is Postgres" — streams,
  transactional, analytical, and object planes with explicit ports — without
  collapsing into premature poly-store complexity.

The goal is a target data architecture that makes agent-created data a
first-class, governable citizen instead of an accumulation of unvalidated
JSON, while keeping the self-hostable single-Postgres deployment as the
default binding for every plane.

## 2. Current Baseline (evidence)

Verified against `origin/main` (642d9a605); corrected by the round-1 double
review.

### 2.1 One transactional database, 57 hardcoded tables

- `api/src/db/schema.ts` defines 57 `pgTable`s: identity/auth (14),
  workspace/membership (3), product business objects (8 + config),
  chat/agent runtime (9), documents metadata (2), comments (1),
  workflow/execution/steering (16), collaboration/locking (2).
- Real business objects today: `organizations` (a CRM-account object — NOT
  tenancy; note the name collision with OpenERP's tenancy `organizations`),
  `folders`, `initiatives`/`useCases`, `solutions`, `products`, `bids`,
  `bid_products`, plus `view_templates` (view DSL) and
  `workspaceTypeWorkflows`.
- Every business object is a fixed Drizzle table; there is NO
  entity-attribute-value system, NO dynamic table creation, NO tenant-defined
  custom fields mechanism (verified absent).
- Enum discipline is uneven: Drizzle declares status/sourceLevel columns as
  plain `text`, and SOME migrations add DB CHECK constraints
  (`tasks.status`, `agent_definitions.source_level`,
  `workflow_definitions.source_level`, `execution_runs.status` — migrations
  0023/0025) while the business-object and workspace tables have none.

### 2.2 Ad-hoc JSON is the de-facto agentic data layer

- 47 `jsonb` columns. The heavy ones are deliberate schema-deferral:
  `organizations.data`, `initiatives.data`, `solutions.data`, `products.data`,
  `bids.data` (the schema-churn comment is explicit on `organizations.data`,
  `schema.ts:37-42`; the others expose bare `data jsonb`).
- Validation: initiatives has field-level zod at the route; organizations
  partial; solutions/products/bids accept `data: z.record(z.unknown())` —
  shape-free. Nothing validates at the storage layer; legacy rows carry no
  shape guarantee. Retrofit note: route zod and any future registry JSON
  Schema are TWO sources of truth for the same shape — one must generate the
  other.
- Registry-pattern precedents exist in TWO variants: `agent_definitions` /
  `workflow_definitions` carry the full set (`sourceLevel + parentId +
  lineageRootId + isDetached + lastParentSyncAt`, `schema.ts:840-894`);
  `view_templates` carries only `sourceLevel + parentId + isDetached`
  (`schema.ts:1180-1204`). Any generalization must pick the FULL variant
  explicitly, not "the pattern".
- `task_io_contracts` (JSON Schema columns, migration 0023) is a DEAD TABLE:
  zero read/write references across api/ui/packages. The LIVE outputSchema
  sources are `workflow_definition_tasks.outputSchema` (consumed in
  `api/src/services/todo-orchestration.ts`) and agent `config.outputSchema`.
  Per the no-legacy rule, `task_io_contracts` is DROPPED (zero references;
  the live sources won).

### 2.3 Streams and queue are Postgres idioms — with real health gaps

- Streaming = `chat_stream_events` append table (unique `(streamId,
  sequence)`, advisory-lock sequence assignment) + Postgres NOTIFY wake-ups,
  served over SSE. The `StreamBuffer` port from chat-core is ALREADY fully
  implemented by `PostgresStreamBuffer` and `stream-service.ts` is a thin
  shim — the stream-port half of the physical abstraction is essentially
  done; what remains is the EventBus wrap.
- Health gap: `chat_stream_events` has NO time-based retention (rows deleted
  only on account deletion) and NO `created_at` index while `listActive`
  filters on `created_at >= now()-6h` — unbounded growth + creeping seq-scan.
- 10 NOTIFY channels fan out domain deltas (`comment_events, folder_events,
  initiative_events, job_events, lock_events, organization_events,
  presence_events, stream_events, workspace_events,
  workspace_membership_events`; 20 emit sites). Domain NOTIFY is
  fire-and-forget on a pooled connection, non-transactional with the write,
  8KB-capped, with no durable log behind it (only `stream_events` replays
  from its append table). No Redis/NATS/Kafka anywhere (verified).
- Job queue REALITY CHECK: `job_queue` has status/data/result/error/timestamps
  only. Claiming = `FOR UPDATE SKIP LOCKED` + status flip; retry = in-place
  requeue with an attempt counter inside the job JSON; failure = status flip.
  There is NO lease column, NO heartbeat, NO dead-letter store, and NO
  boot-time reaper — a crashed worker strands jobs in `processing` forever.
  The `packages/flow/src/job-queue.ts` header comment
  ("lease/heartbeat/DLQ/idempotency") is aspiration, not code.
- `EventEnvelope` exists in `@sentropic/contracts`, wired only via comments
  (chat-core exposes an `EventSink` type surface); no outbox; no audit table
  (ARCH-14 owns the spine).

### 2.4 No analytical plane, no knowledge plane

- Zero analytics infrastructure: no Iceberg/parquet/DuckDB/ClickHouse, no
  materialized views, no aggregate tables; `analytics.ts` computes aggregates
  in JS. Agent stats/track live OUTSIDE the product (`stp track`).
- Zero knowledge infrastructure in-runtime: no pgvector, no tsvector/FTS, no
  entity extraction, no reconciliation. `entity_links` is manual and
  unreconciled. Graphify is external (`graphifyy@0.7.10`, `stp knowledge`),
  fusion gated on `plan/34` Lot 0 (ARCH-06). There is NO search of any kind
  across business objects today.

### 2.5 Physical coupling is real but localized

- 26 route modules import `db` directly (~104 `db.` references in routes,
  more in services) — no repository layer between HTTP and Drizzle.
- Postgres-isms in use: pgcrypto (encrypted signing keys, jwks-adapter),
  NOTIFY/LISTEN, advisory locks, `FOR UPDATE SKIP LOCKED`, CASCADE deletes.
- S3-compatible artifact storage exists (`api/src/services/storage-s3.ts`,
  MinIO dev / Scaleway prod) with direct SDK calls, no port. Artifact bytes
  are ALREADY outside Postgres — backup/restore is already a two-store story
  (`make db-backup` does not cover S3).

### 2.6 Adjacent constraints this study must respect

- Tracker decisions (binding): D1=B tenant=org/account (ARCH-11 reconciles
  the three live tenant meanings — `tenantId := workspaceId` aliasing is in
  production); D2=B app templates = DB control-plane resources; D3=A guest
  rows in `users`; D6=B internal Postgres quota/cost ledger; D7=A flagship
  retro-modeling; D11=B published-contract breaking changes via major bump,
  additive-preferred, gated on ARCH-12.
- OpenERP (org B, B2B2B): owns its OWN Postgres with `organizations` +
  `organization_members` + forced RLS on `organization_id`, federated
  identity (AX2). It has NO workspaces — its scope unit is the organization.
  Universality is a CONTRACT story with OpenERP, never a shared database.
- Self-hosting (ARCH-10 portability annex): single-Postgres must remain a
  fully functional default deployment; every additional engine is an
  optional binding behind a port.

## 3. Target Concepts

### 3.1 Axis A — Control-plane core data (the PaaS spine)

- Control-plane resource families (most already decided in the tracker):
  `tenants` + resource bindings (D1, ARCH-11), `app_templates` /
  `app_instances` / `app_workspace_bindings` (D2, ARCH-01), `dev_remotes` /
  `uat_endpoints` / `app_deployments` (ARCH-05/17), quota/cost ledger (D6,
  ARCH-13), audit + event outbox + projections (ARCH-14), `IndexSnapshot`
  registry (ARCH-06), `object_type_definitions` (this study, ARCH-19).
- Namespace rule: control-plane tables form a DISTINCT Postgres schema
  (`control`) with their OWN migration stream. NO NEW cross-namespace foreign
  keys (IDs only across the boundary) — scoped to new `control.*` tables; the
  existing product tables keep their FKs. This keeps later physical
  separation cheap. Note: the identity/auth family (14 tables) is a THIRD
  namespace with a planned physical extraction (IdP Phase D) — the same
  IDs-not-FKs rule will apply at that seam when Phase D executes.
- Control-plane tables get DB-level discipline that product tables lack:
  CHECK constraints on enum-like columns (including `sourceLevel`, extended
  with `'agent'`).
- Audit and the quota ledger are APPEND-ONLY families with retention policy
  (ARCH-15) and are the first candidates for analytical export (Axis E).
  Ledger write-path posture (sync insert on the hot LLM path vs async via
  outbox) is an ARCH-13 frame question.

### 3.2 Axis B — Universal Business Objects (UBO)

- **Core envelope**: `id`, `objectType`, **scope** (a binding-defined map:
  Sentropic binding = `tenantId` + `workspaceId`; OpenERP binding =
  `organizationId` — a required bare `workspaceId` would force every external
  builder to fake one), `status`, `version` (object version, CAS target),
  `payloadSchemaVersion` (schema version of the payload — distinct from
  object version, day-1 field), `createdBy`/`ownedBy`, timestamps,
  `deletedAt` (soft delete), `lineage`, `origin` (code|admin|user|agent).
  `tenantId` is written as derived-from-workspace pending ARCH-11, with the
  re-key event pre-declared.
- **Object type registry** (`object_type_definitions`, control-plane
  resource): key, version, payload JSON Schema (meta-validated), **declared
  queryable fields** (driving generated indexes), **typed reference fields**
  (DD7: lookup vs containment, cardinality, on-delete policy — IDs, not DB
  FKs), view hints, lifecycle states, PII/secret classification flags per
  field, sourceLevel (code|admin|user|agent) + FULL lineage variant
  (parentId, lineageRootId, isDetached, lastParentSyncAt) + CHECK-constrained
  sourceLevel.
- **Anti-pollution discipline** (the real Salesforce failure mode is junk
  custom objects, at machine speed when agents mint them): shape
  fingerprinting + dedup at ingest (match against existing draft types before
  creating one), a quarantined `draft` namespace, TTL on unused draft types,
  per-workspace caps on agent-sourced types.
- **Storage strategy (DD1)**: hot first-party objects KEEP their dedicated
  tables; registered custom/agentic objects land in a generic
  `business_objects` table (envelope columns + payload jsonb + objectType ref).
  Day-1 indexes: btree `(workspace_id, object_type, status)` + GIN on
  payload; per-type EXPRESSION indexes are an admin-driven registry feature
  under an explicit runtime-DDL policy (lock impact, migration ownership,
  self-host story). Both storages share the envelope contract, made true in
  practice by a registry-driven **envelope union view** and an
  `ObjectResolverPort` (`objectType → storage`) used by comments, locks,
  search, knowledge, quota, export — no hand-rolled UNIONs per consumer.
  Tier-3 promotion (dedicated table) is reserved for types needing real
  FKs/constraints, with a written migration recipe (ID stability, cutover,
  snapshot refs).
- **Existing-object retrofit**: organizations/folders/initiatives/... are
  RETRO-DECLARED in the registry. Lot-0 deliverable: SHAPE-MINING of
  production rows (profile real `.data` shapes) so the registered schema
  matches reality instead of aspiration; the registry JSON Schema is the
  single source of truth and the route zod is GENERATED from it (one
  direction, never two hand-maintained copies).
- **Standard type naming**: the CRM object is `account` (or `company`), NOT
  `organization` — the collision between Sentropic's CRM `organizations` and
  OpenERP's tenancy `organizations` is resolved at the standard-set level.
  Standard type NAMES are durable names: owner sign-off happens at the DD3
  standard-set freeze.
- **OpenERP universality (the 90% claim)**: contract-level only — a published
  package (home = DD6) carrying the envelope type, registry wire format, and
  standard object-type schemas. The DD3 mapping exercise MUST include at
  least one transactional document chain (order → lines → invoice) — master
  data (contacts, accounts, opportunities) is the easy part; ERP documents
  with relational invariants (stock moves, double-entry) are where the
  hypothesis can die. Time-boxed co-design with claude:openerp; registry
  MECHANICS proceed regardless, only the standard-set freeze waits.

### 3.3 Axis C — Knowledge and ontologies

- **Two layers, not one**: object types (operational schemas, ARCH-19) vs
  entity/relation ontology + resolution provenance (semantic layer, ARCH-06).
  Operational schemas never masquerade as semantic truth; reconciliation
  confidence never substitutes for type validation.
- Entity types and relation types are registered with the same
  sourceLevel+lineage governance, so tenants extend the ontology without
  forking the platform.
- **Graphify as the reconciliation engine** (ARCH-06 frame): flow-invoked
  indexing jobs on runners, S3 `IndexSnapshot` artifacts, extracting named
  entities from repos/docs/chats AND business-object payloads (respecting
  the registry's PII/secret classification flags).
- **`entity_links` upgrade**: a provenance-carrying `entity_resolutions`
  store written by indexing jobs (entityId ↔ objectId/documentId/messageRef +
  confidence + snapshotRef), queryable through `knowledge_search`. Manual
  links remain the human-confirmed tier. ARCH-06 frame additions: resolution
  lifecycle when a newer `IndexSnapshot` supersedes an older one
  (invalidation/GC), and the mapping between graphify's own node taxonomy
  and registered entity types (graphify is an external tool — same
  consumer-co-design constraint as OpenERP).
- **Embeddings are an opt-in binding (DD5)** behind a KnowledgeQueryPort,
  gated on a real retrieval consumer. Owner orientation (DD5 rider): the
  knowledge base is primarily the LLM-wiki/graph layer produced via graphify;
  vector retrieval is an ADDITION (pgvector preferred binding) subordinate to
  the graph layer. **Plain keyword search is NOT gated**:
  opt-in tsvector generated columns per registered type are a reversible
  default (there is zero search today; basic search must not be hostage to
  the vector or graphify gates).
- **Provenance is mandatory**: every knowledge assertion carries source
  revision, extraction run, and confidence.

### 3.4 Axis D — Agentic data (ad-hoc creation, governed promotion)

The tier ladder, hardened:

1. **Tier 0 — ephemeral**: tool-call payloads, traces, stream events.
   Append-only, retention-bound — which today is only TRUE for
   `chat_generation_traces` (7-day sweep); extending the sweep to
   `chat_stream_events` (+ a `created_at` index) is a hardening prerequisite,
   not an existing property.
2. **Tier 1 — ad-hoc objects**: an agent materializes a JSON object. It lands
   in `business_objects` with `origin='agent'`, an envelope, an actor chain,
   an `IdempotencyKey` (exists in `@sentropic/contracts`, unwired today), and
   an INFERRED draft schema — fingerprint-deduped against existing draft
   types. Draft-schema sources: `workflow_definition_tasks.outputSchema` and
   agent `config.outputSchema` (the LIVE sources — `task_io_contracts` is
   dead and must be wired or dropped), meta-validated as JSON Schema before
   use. Flood control: per-workspace row/byte caps on `origin='agent'`
   objects, reported through the D6 ledger (a looping agent burns little LLM
   budget while inserting unbounded rows — the ledger alone does not cover
   this abuse vector).
3. **Tier 2 — registered type**: promotion = **copy/backfill/verify/switch**
   with a conformance report and per-row quarantine status — never a flag
   flip on live rows. Writes validate against the registered schema with the
   DD2 ladder; the WARN SINK is in-band: warning returned in the tool result
   to the writing agent + per-type conformance counters queryable in admin +
   an explicit enforce-flip criterion (e.g. <X% nonconforming writes over N
   days). Correction path for a wrong promotion: SUPERSEDE with schema v2 +
   migration transform (DD8) — deletion only for abandoning a type, never as
   the fix for bad data.
4. **Tier 3 — first-party type**: dedicated tables and code (the existing 8
   business tables are Tier 3).

- Concurrent agent writes: optimistic CAS on `envelope.version`; idempotent
  retries via `IdempotencyKey`; merge policy per object type where CAS
  conflicts are expected.
- TTL/lifecycle deletion of Tier-1 objects includes a polymorphic-reference
  sweep (comments, locks, entity_links, entity_resolutions point at objects
  through `(contextType, contextId)` strings — no cascade exists).

### 3.5 Axis E — Physical layer: four planes behind ports

| Plane | Today (default binding) | Port | Later bindings (opt-in) |
|---|---|---|---|
| Transactional | Postgres + Drizzle (57 tables) | repository seams ONLY at new surfaces (`business_objects` + control plane) — no big-bang layer over 26 routers | any SQL via Drizzle dialect; physical split control/product |
| Stream | `chat_stream_events` + NOTIFY + SSE | `StreamBufferPort` is DONE (PostgresStreamBuffer implements chat-core's port); remaining: `EventBusPort` wrapping the 10 NOTIFY channels | Redis Streams / NATS for fan-out at scale; PG stays durability |
| Analytical | none (JS aggregates over PG rows) | `AnalyticsSinkPort`: outbox → append files | object storage + Parquet first, Iceberg when a catalog is justified; DuckDB-class query |
| Object/artifact | S3 service, direct SDK calls | `ArtifactStorePort` (wrap storage-s3.ts; + metadata/checksum/versioning) | any S3-compatible; local FS for dev/self-host |

- **Durability layering (the one sentence that prevents laundering)**:
  the OUTBOX (ARCH-14, Postgres table) is the durable source of truth for
  domain events — at-least-once, consumer idempotency, per-aggregate
  ordering, explicit retention/compaction; the EVENT BUS is wake-up-only
  (today's NOTIFY is fire-and-forget, non-transactional, 8KB-capped — the
  port does not change that); any consumer needing guaranteed delivery reads
  the outbox, never the bus; the StreamBuffer is the chat replay log.
- **Outbox vs CDC, stated precisely**: outbox carries intentional DOMAIN
  events (the envelope/contract worldview). Analytical export of full table
  STATE is a different need; the recorded fallback if outbox-fed export ever
  proves insufficient is plain Postgres logical replication (a slot +
  wal2json — no Debezium, no Kafka). This keeps the "no CDC tooling" posture
  falsifiable instead of dogmatic.
- **Analytical plane is pulled by consumers**: first candidates are ledger
  reporting (D6) and track/agent-stats. Gate (DD4): no lake infrastructure
  before one consumer commits to reading it, WITH a consumer-owned cost +
  backup/restore model (Parquet/Iceberg bring compaction, catalog,
  retention, GDPR-erasure-on-immutable-files work).
- **Enforcement is mechanical, not textual**: "no new raw NOTIFY / no raw
  `db` above the ports in new planes" is enforced by a CI grep gate + an
  exception register — policy text alone is unenforceable (the 21 existing
  emit sites prove it).
- **Postgres-isms register** (pgcrypto, advisory locks, NOTIFY, FOR UPDATE):
  allowed inside binding implementations, forbidden in domain code above the
  ports — registered as an ARCH-10 portability-annex rule.
- **Hardening prerequisite (branch-ready now, no study needed — PRIORITY:
  lands BEFORE any outbox dispatcher or UBO storage work)**: queue
  stranded-`processing` recovery (reaper or lease columns — the outbox
  dispatcher must NOT inherit zero crash recovery), `chat_stream_events`
  retention sweep + `created_at` index, the flow package comment fixed to
  match reality, and the `task_io_contracts` drop migration.

## 4. What proves each axis

- Axis A: quota/cost ledger (ARCH-13) in the `control` namespace with
  append-only entries + CHECK discipline = first control-plane proof.
- Axis B: ONE standard type (`opportunity`) registered via shape-mining of
  `initiatives.data`, served through the envelope union view, plus the
  OpenERP mapping exercise including order→lines→invoice = UBO proof (or
  revised hypothesis).
- Axis C: graphify indexing job over one workspace producing an
  `IndexSnapshot` whose entities resolve to business objects via
  `entity_resolutions` with provenance = knowledge proof (gated on fusion
  Lot 0).
- Axis D: one agent workflow whose task `outputSchema` materializes Tier-1
  objects (idempotent, capped, fingerprint-deduped) promoted to a registered
  type through copy/backfill/verify/switch with an in-tool-result warn phase
  = agentic-data proof.
- Axis E: the outbox feeding (a) a track projection and (b) a Parquet append
  read by DuckDB for ledger reporting = multi-plane proof; PLUS the
  hardening prerequisite branch landed (queue reaper, stream retention).

## 5. Risks and anti-goals

1. **Big-bang abstraction**: ports are cut at NEW seams only; existing
   product CRUD moves only with a consumer-driven reason.
2. **Registry pollution (the real EAV-hell)**: agent-minted near-duplicate
   draft types at machine speed — fingerprint dedup, draft quarantine, TTL,
   and caps are registry-design requirements, not options.
3. **Premature poly-store**: every engine is an ops burden for self-hosters —
   ports default to Postgres bindings; analytical bindings are
   consumer-gated with cost/restore models.
4. **Shared-database temptation with OpenERP**: universality is contracts +
   federation; their RLS tenancy stays theirs.
5. **Ontology landgrab**: one global ontology kills adoption — sourceLevel/
   lineage forking is the governance mechanism, and operational schemas
   (ARCH-19) stay distinct from semantic truth (ARCH-06).
6. **Schema-validation cliff**: hard validation over legacy `.data` rows
   breaks production — warn→enforce with in-band warn sink, conformance
   counters, per-type opt-in, and shape-mined (not aspirational) schemas.
7. **Knowledge without provenance**: refused at the contract level.
8. **Contract churn**: the envelope + registry wire format are published
   surfaces — D11/ARCH-12 applies from v0; package home (DD6) decides the
   blast radius of envelope iteration.
9. **Stranded references**: polymorphic `(contextType, contextId)` strings
   have no cascade — every lifecycle deletion sweeps references.
10. **Erasure across planes**: GDPR delete must reach S3 artifacts, Parquet
    exports (rewrite or crypto-shredding), and outbox history — ARCH-15
    scope, named now.
11. **Backup/restore divergence**: already a two-store reality (PG + S3);
    every plane added splits the restore point further — ARCH-10/15 annex.
12. **Crash-recovery debt**: the queue idiom has no reaper today; building
    the outbox dispatcher on it without hardening inherits the debt.

## 6. Relation to the architecture tracker

- This study registers as **ARCH-18 (master data architecture)** in
  `SPEC_EVOL_ARCHITECTURE.md` §7.
- **ARCH-19 — Universal Business Objects & object type registry** is the
  single net-new sub-study (Axis B+D), co-designed with OpenERP (time-boxed).
  Its lots are split PAPER-first: Lot 0 = inventory (shape-mining of `.data`
  rows + OpenERP real-schema mapping incl. one document chain); Lot 1 =
  registry v0 + envelope contract; storage lots are GATED on (a)
  `envelope.tenantId` semantics ← ARCH-11 (or the derived-from-workspace
  default with pre-declared re-key), (b) object CRUD event emission ←
  ARCH-14 outbox (or explicitly event-less first cut).
- **No ARCH-20**: the v1 idea of a "physical planes" study is dissolved —
  stream EventBus wrap + durability statement → ARCH-14; `ArtifactStorePort`
  → small standalone branch; analytical export → behind DD4's consumer gate
  (ARCH-13's reporting consumer); Postgres-isms register + bindings policy →
  ARCH-10 portability annex. A standing planes-study would invite building
  plane infrastructure for its own sake (anti-goal 3).
- Assignments into existing studies: control-plane families → ARCH-01/11/13/
  14 (+ the namespace/no-new-cross-FK rule, + ledger write-path posture to
  ARCH-13); knowledge pipeline → ARCH-06 (+ entity_resolutions lifecycle +
  graphify-taxonomy mapping); retention/GDPR/erasure-across-planes + PII
  classification → ARCH-15.
- Coupling corrections: ARCH-19's real gates are ARCH-11 (tenant) and
  ARCH-14 (events) — NOT ARCH-13 (the ledger references objects by loose ID;
  no phantom dependency drags ARCH-19 storage into Wave 1).
- **Hardening prerequisite branch** (no study): queue crash recovery,
  `chat_stream_events` retention + index, flow comment fix,
  `task_io_contracts` wire-or-drop.

## 7. Owner decisions (DD1-DD11) — DECIDED 2026-06-07

Refined by the round-2 decision-packet audit (both auditors), answered by the
owner on 2026-06-07. Cross-references in sections 3-6 were re-verified
against this table.

| ID | Decision | Options | Recommendation | Status |
|---|---|---|---|---|
| DD1 | UBO storage substrate | A all objects migrate to one generic table; B generic `business_objects` ONLY for registered custom/agentic types, first-party tables stay — WITH resolver port, envelope union view, declared-queryable-fields indexes (tenant-isolation posture = DD9); C no generic store (config files / dedicated tables only) | B — A is a pointless migration, C re-creates the swamp; B's resolver/view/index requirements are part of the decision. Storage lots remain gated per §6 (B decides the posture, not the date) | DECIDED B |
| DD2a | Validation ladder — first-party `.data` retrofit | A document-only (registry as docs); B shape-mined schemas + warn → per-type enforce opt-in, with per-row validation state + quarantine, registry JSON Schema as single source (route zod generated from it); C hard-validate now | B — C breaks legacy rows, A changes nothing | DECIDED B |
| DD2b | Validation ladder — Tier-2 agentic types | A warn default WITH in-tool-result warnings to the writing agent + per-type conformance counters + explicit enforce-flip criterion; B enforce-by-default at registration | A — a log-only warn is a delay, not a ladder (agents don't read logs); B breaks first workflows blind | DECIDED A |
| DD3 | OpenERP co-design gate (blocks the STANDARD-SET FREEZE only, never registry mechanics) | A Sentropic defines standard types alone; B time-boxed mapping with claude:openerp, corpus MUST include ≥1 transactional document chain (order→lines→invoice); C defer OpenERP | B — the 90% claim is theirs to falsify; master data alone would fake-validate it. Rider: standard type NAMES (incl. `account` vs `company`) get owner sign-off at the freeze | DECIDED B (naming sign-off at freeze) |
| DD4 | Analytical/state-export gate (the outbox itself is an ARCH-14 prerequisite, not this decision) | A build lake infrastructure now; B export lands with its first committed consumer (ledger reporting or track) + consumer-owned cost & backup/restore model; logical replication (slot+wal2json, no Debezium/Kafka) recorded as the state-export fallback; C never (PG/JS reporting only) | B | DECIDED B |
| DD5 | Embeddings/vector binding (FTS is NOT in this gate — see defaults) | A pgvector now; B defer behind KnowledgeQueryPort until a retrieval consumer ships; C external vector DB now | B. Owner note (decision rider): the knowledge base is primarily the LLM-wiki/graph layer produced via graphify, NOT vector-first — when the retrieval consumer ships, pgvector (A) is the preferred ADDITION, subordinate to the graph layer | DECIDED B (then A as addition) |
| DD6 | UBO contract package home + publication timing | A separate in-repo workspace package from v0, npm publication DEFERRED until the envelope is proven (first proof or first external consumer — OpenERP needs schemas for the DD3 paper mapping, not a tarball); B separate package published immediately; C fold into `@sentropic/contracts` as a subpath, extract later | A — both round-2 auditors landed here independently. Against C: every envelope iteration becomes a contracts version event for comments/chat-* under D11, extraction is a guaranteed future breaking move, and D11 forbids landing a contracts mutation before ARCH-12 (a NEW package is not a contracts mutation). Against B: the chat-ui publish-trap history argues for zero publish-pipeline exposure while incubating. Package NAME = owner durable-naming call at publication time | DECIDED A |
| DD7 | Relationship/composition model in the registry | A nested-in-payload only (documents are blobs — no cross-document queries); B typed reference fields: lookup + containment, cardinality, on-delete policy, IDs not DB FKs; C relational promotion (Tier 3) required for any document type | B — A kills the ERP claim on line items, C kills agentic creation of document types. Frozen into the published wire format → blocking | DECIDED B |
| DD8 | Registered-type schema evolution policy | A per-row `payloadSchemaVersion` + additive-compatible default + explicit migration transforms + supersede-with-v2 as correction path; B validate-on-read against latest, free re-versioning; C immutable types, new type per change | A — gates any enforce flip; without it a wrong promotion can only be fixed by deleting data | DECIDED A |
| DD9 | Tenant isolation posture for `business_objects` | A app-level WHERE discipline only; B composite `(tenant_id, workspace_id)` columns + indexes now, tenantId derived-from-workspace pending ARCH-11 with pre-declared re-key (answering B = explicitly accepting that re-key posture), DB RLS revisited at a named trigger (OpenERP-parity review); C DB RLS from day 1; D block `business_objects` storage entirely until ARCH-11 lands | B — a generic multi-tenant table is a sharper isolation risk than dedicated tables; C's ops cost is premature; D serializes ARCH-19 on ARCH-11 for little gain given the pre-declared re-key | DECIDED B (re-key posture accepted) |
| DD10 | Envelope v0 ratification (an irreversible PUBLISHED surface — cannot live in the defaults list) | A ratify the §3.2 field set: binding-defined scope map (Sentropic binding = tenantId+workspaceId; external builders define theirs), `payloadSchemaVersion`, `deletedAt`, CAS `version`, `IdempotencyKey` on agent writes, `origin`, lineage; B fixed `tenantId`+`workspaceId` scope (Sentropic-shaped, forces external builders to fake workspaces); C no scope in the envelope (payload-level scoping) | A — B breaks universality (OpenERP has no workspaces), C makes quotas/audit/knowledge unable to key on the envelope | DECIDED A |
| DD11 | Runtime-DDL/index policy for registry-driven expression indexes | A no runtime DDL ever (indexes via normal migrations only); B admin-approved GENERATED migration/index job with lock budget + rollback; C direct runtime DDL by the registry | B — A starves registered types of usable indexes, C is uncontrolled DDL on prod | DECIDED B |

Reversible defaults — adopted unless evidence says otherwise. Items that
reference DD-gated structures are CONDITIONAL on the recommended DD answers
(noted inline):

- Registry reuses the FULL `agent_definitions` lineage variant + CHECK
  constraint on `sourceLevel` (values include `agent`).
- Draft schemas inferred from `workflow_definition_tasks.outputSchema` and
  agent `config.outputSchema`, JSON-Schema-meta-validated;
  `task_io_contracts` DROPPED (no-legacy rule; zero references).
- `business_objects` day-1 indexes (if DD1=B): btree `(workspace_id,
  object_type, status)` + GIN payload; expression indexes under the DD11
  policy.
- Promotion mechanism = copy/backfill/verify/switch with conformance report
  + per-row quarantine; no permanent dual-write (both reviewers convergent).
- FTS = opt-in tsvector generated column per registered type (not gated on
  DD5).
- Per-workspace row/byte caps on `origin='agent'` objects; draft-type
  fingerprint dedup + TTL on unused drafts (if DD1=B).
- Tier-0 retention extended to `chat_stream_events` (sweep + `created_at`
  index); Tier-1 TTL deletion sweeps polymorphic references.
- Hardening prerequisite branch lands BEFORE any outbox dispatcher or UBO
  storage work (invariant across all DD outcomes — scheduling, not a fork).
- Outbox = Postgres table per ARCH-14, at-least-once + consumer idempotency +
  per-aggregate ordering + retention/compaction stated; EventBusPort =
  wake-up-only, durable delivery reads the outbox.
- Parquet before Iceberg; Iceberg needs catalog/compaction/restore
  justification (if DD4=B).
- ArtifactStorePort wraps storage-s3.ts + metadata/checksum/versioning;
  local-FS binding for self-host dev.
- `control` namespace = Postgres schema `control`, no NEW cross-namespace
  FKs — proposed; confirmed by the first control-plane study (ARCH-13).
- CI grep gate + exception register enforce the no-raw-NOTIFY / no-raw-db
  rules on new planes.
- Retrofit validation source (if DD2a=B): registry JSON Schema generates the
  route zod (one direction).

## 8. Review log

- 2026-06-07: v1 drafted from a read-only repo inventory grounded in tracker
  decisions D1-D11.
- 2026-06-07: Round 1 — double adversarial review (Codex 5.5 xhigh + Opus
  4.8, both GO-WITH-CHANGES). Falsifications fixed: job_queue has NO
  lease/heartbeat/DLQ/reaper (flow package comment is aspirational); 10
  NOTIFY channels (not 14); `task_io_contracts` is a dead table (live
  schema sources = workflow_definition_tasks + agent config);
  `view_templates` lacks lineageRootId (two pattern variants);
  `chat_stream_events` unbounded + missing created_at index; 47 jsonb;
  artifact bytes already in S3; StreamBufferPort already implemented.
  Concepts hardened: registry anti-pollution (fingerprint/TTL/caps), typed
  reference fields (DD7), schema evolution with per-row version +
  supersede-with-v2 (DD8), promotion = copy/backfill/verify/switch, in-band
  warn sink + flip criteria, ObjectResolverPort + envelope union view,
  binding-defined scope map (workspaceId not universal; tenantId gated
  ARCH-11), `account` rename, outbox-vs-bus durability layering + logical-
  replication fallback, runtime-DDL policy, agent write CAS/idempotency/
  caps, GDPR erasure across planes, ARCH-20 dissolved (ARCH-19 = only
  net-new study), hardening prerequisite branch identified. DD packet
  rewritten: DD1-DD5 hardened, DD6 = package home (reviewers diverge —
  owner arbitration), DD7-DD9 added; v1's DD6 (stream ports) demoted to
  defaults, v1's DD7 folded into DD6.
- 2026-06-07: Round 2 — double decision-packet audit (Codex 5.5 xhigh + Opus
  4.8, both GO-WITH-CHANGES). Fixed: DD7/DD8 cross-reference swaps in §3.2/
  §3.4 (answer-corrupting); DD2 split into DD2a/DD2b with enumerated
  options; DD1 de-overlapped from DD9 (tenant-isolation bundling removed);
  envelope moved OUT of reversible defaults into DD10 (irreversible
  published surface + scope-map ratification); DD11 (runtime-DDL policy)
  added; DD9 gains option D (block until ARCH-11); DD4 reframed as the
  state-export gate (outbox = ARCH-14 prerequisite); DD6 rewritten with the
  auditors' CONVERGENT independent position (separate package from v0,
  publication deferred to first proof/consumer — D11 asymmetry: a new
  package is not a contracts mutation); DD3 scoped to standard-set freeze +
  naming rider; defaults marked conditional on DD answers; `control`
  namespace marked proposed-pending-ARCH-13; task_io_contracts → DROPPED;
  CHECK-constraint baseline nuanced (migrations 0023/0025 DO add some); 20
  NOTIFY emit sites; shape-mining = Lot 0; dates normalized to 2026-06-07;
  `.tmp` artifact references removed from the status header.
