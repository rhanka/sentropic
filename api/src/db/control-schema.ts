/**
 * Control schema — internal infrastructure tables.
 *
 * This is the FIRST resident of the `control` Postgres schema (ARCH-14 event-spine).
 * Lives in its OWN migration stream (api/drizzle/control/) applied AFTER the `public`
 * stream in run-migrations.ts.
 *
 * Guardrails:
 * - NO cross-namespace FK to public tables (soft `aggregate_id` only — control-namespace rule).
 * - NO published-contract mutation (@sentropic/contracts / @sentropic/comments untouched).
 */

import { bigint, check, index, integer, jsonb, pgSchema, primaryKey, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Declare the `control` schema namespace.
export const controlSchema = pgSchema('control');

/**
 * control.event_outbox — transactional outbox table (ARCH-14 / BR-60).
 *
 * Durability: OUTBOX is the durable source of truth (at-least-once, per-aggregate
 * ordering). The EventBusPort is wake-up-only; any consumer needing guaranteed
 * delivery reads this table, not the bus.
 *
 * DDL spec (SPEC_EVOL_OUTBOX_V0.md §1 Q1 / SPEC_EVOL_EVENT_SPINE.md §2 Q1):
 * - UNIQUE (aggregate_type, aggregate_id, seq) — per-aggregate ordering.
 * - Index: (status, aggregate_type, aggregate_id, seq) — pending ordered dispatch.
 * - Index: (tenant_id, workspace_id) — DD9 isolation.
 * - CHECK: status in ('pending','processing','dispatched','failed').
 * - CHECK: attempts >= 0.
 */
export const eventOutbox = controlSchema.table(
  'event_outbox',
  {
    id: text('id').primaryKey(),

    // Aggregate identity (soft references — no cross-namespace FK).
    aggregateType: text('aggregate_type').notNull(),
    aggregateId: text('aggregate_id').notNull(),

    // Per-aggregate monotonic sequence (advisory-lock allocation).
    seq: bigint('seq', { mode: 'number' }).notNull(),

    // Event envelope (NOT contract-bound — can carry EventEnvelope or DD10 UBO shape).
    envelope: jsonb('envelope').notNull(),

    // Internal trace / lineage columns (ARCH-14 Q4 — no @sentropic/contracts mutation).
    traceId: text('trace_id'),
    lineage: jsonb('lineage'),
    origin: text('origin'),

    // DD9 isolation (tenant + workspace scope).
    tenantId: text('tenant_id'),
    workspaceId: text('workspace_id'),

    // Dispatch lifecycle.
    status: text('status').notNull().default('pending'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),

    // Timestamps.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),

    // Dispatcher wake channel (stored so consumers can subscribe to the right channel).
    channel: text('channel').notNull(),
  },
  (table) => ({
    // Per-aggregate ordering constraint.
    aggregateSeqUnique: uniqueIndex('event_outbox_aggregate_seq_unique').on(
      table.aggregateType,
      table.aggregateId,
      table.seq,
    ),
    // Pending ordered dispatch index.
    statusDispatchIdx: index('event_outbox_status_dispatch_idx').on(
      table.status,
      table.aggregateType,
      table.aggregateId,
      table.seq,
    ),
    // DD9 isolation index.
    tenantWorkspaceIdx: index('event_outbox_tenant_workspace_idx').on(
      table.tenantId,
      table.workspaceId,
    ),
    // Status CHECK constraint.
    statusCheck: check(
      'event_outbox_status_check',
      sql`${table.status} IN ('pending', 'processing', 'dispatched', 'failed')`,
    ),
    // Non-negative attempts CHECK.
    attemptsCheck: check(
      'event_outbox_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
  }),
);

export type EventOutboxRow = typeof eventOutbox.$inferSelect;
export type EventOutboxInsert = typeof eventOutbox.$inferInsert;

/**
 * control.object_type_definitions — the object-type registry (ARCH-19 / BR-59).
 *
 * Registers a UBO object type: payload JSON Schema, declared queryable fields
 * (drive generated indexes — index-generation is BR-61, NOT here), DD7 typed
 * references (lookup vs containment, cardinality, ID-level on-delete — never a
 * DB FK), and PII/secret classification. Wire shape = @sentropic/ubo-contracts
 * `ObjectTypeDefinition`.
 *
 * Guardrails: control namespace, NO cross-namespace FK, CHECK discipline, DD9 isolation.
 * Storage of the objects themselves (`business_objects`) is BR-61 (gated on ARCH-11).
 */
export const objectTypeDefinitions = controlSchema.table(
  'object_type_definitions',
  {
    id: text('id').primaryKey(),
    objectType: text('object_type').notNull(),
    // null = global / first-party type; set = tenant-scoped custom type (DD9).
    tenantId: text('tenant_id'),
    jsonSchema: jsonb('json_schema').notNull(),
    declaredQueryableFields: jsonb('declared_queryable_fields').notNull().default(sql`'[]'::jsonb`),
    typedReferenceFields: jsonb('typed_reference_fields').notNull().default(sql`'[]'::jsonb`),
    classification: jsonb('classification').notNull().default(sql`'[]'::jsonb`),
    schemaVersion: integer('schema_version').notNull().default(1),
    status: text('status').notNull().default('draft'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    // One definition per (object_type, tenant); global types (tenant null) coalesced to '' for uniqueness.
    objectTypeTenantUnique: uniqueIndex('object_type_definitions_type_tenant_unique').on(
      table.objectType,
      sql`coalesce(${table.tenantId}, '')`,
    ),
    tenantIdx: index('object_type_definitions_tenant_idx').on(table.tenantId),
    statusCheck: check(
      'object_type_definitions_status_check',
      sql`${table.status} IN ('draft', 'active', 'deprecated')`,
    ),
    schemaVersionCheck: check(
      'object_type_definitions_schema_version_check',
      sql`${table.schemaVersion} >= 1`,
    ),
  }),
);

export type ObjectTypeDefinitionRow = typeof objectTypeDefinitions.$inferSelect;
export type ObjectTypeDefinitionInsert = typeof objectTypeDefinitions.$inferInsert;

/**
 * control.app_templates — versioned app blueprint (ARCH-01 / BR-45, SPEC_EVOL_APP_CATALOG §2 Q2).
 *
 * D2=B: the PRODUCT control-plane source of truth for apps; the in-memory catalog is NEVER
 * the app source of truth (the `kind:'app'` projection is BR-46). A PUBLISHED template row is
 * IMMUTABLE — reconciliation state (desired/observed) is NOT here; it lives on instances.
 * `family_id` is the stable app-family id (groups version rows); `id` is the version-row id.
 *
 * NAMING NOTE (framed D0): `control.app_templates`/`app_instances`/`app_instance_hostnames`/
 * `app_workspace_bindings` are working names pending owner validation at impl — merge HOLDS.
 */
export const appTemplates = controlSchema.table(
  'app_templates',
  {
    // Version-row id (one row per published/draft version).
    id: text('id').primaryKey(),
    // Stable app-family id (groups versions) — distinct from the version-row id.
    familyId: text('family_id').notNull(),
    appSlug: text('app_slug').notNull(),
    // Control-plane resource version (semver), NOT a package version.
    version: text('version').notNull(),
    status: text('status').notNull().default('draft'),
    blueprint: jsonb('blueprint').notNull(),
    // DD8 mirror — the blueprint vocabulary schema version.
    blueprintSchemaVersion: integer('blueprint_schema_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    // Append-only version rows: one per (app_slug, version).
    slugVersionUnique: uniqueIndex('app_templates_slug_version_unique').on(table.appSlug, table.version),
    // One row per (family_id, version) — the instance pin addresses a template by this pair.
    familyVersionUnique: uniqueIndex('app_templates_family_version_unique').on(table.familyId, table.version),
    statusCheck: check(
      'app_templates_status_check',
      sql`${table.status} IN ('draft', 'published', 'deprecated')`,
    ),
  }),
);

export type AppTemplateRow = typeof appTemplates.$inferSelect;
export type AppTemplateInsert = typeof appTemplates.$inferInsert;

/**
 * control.app_instances — a template bound to a tenant + environment, reconciled (BR-45).
 *
 * Pins `template_family_id` + `template_version` (the bound version). The instance `status`
 * (`provisioning|active|suspended|retired`) is a SEPARATE state machine from the template
 * `status`. `observed_state` is FILLED BY ARCH-17 (deployment execution stays OUT of BR-45 —
 * this table only declares the columns). Tenant: composite columns, no re-key (ARCH-11 owns
 * the `identity_tenant_id` backfill). Soft ref to the template (control-namespace rule).
 */
export const appInstances = controlSchema.table(
  'app_instances',
  {
    id: text('id').primaryKey(),
    templateFamilyId: text('template_family_id').notNull(),
    templateVersion: text('template_version').notNull(),
    // IdP tenant (grandfather-compatible value until ARCH-11 re-key). ARCH-11 G1a (§4.1.5): gains a
    // DEFAULT-safe default so rolling-deploy inserts satisfy NOT NULL; `identity_tenant_id` is the
    // real-tenant column backfilled by control migration 0003.
    tenantId: text('tenant_id').notNull().default('sentropic'),
    identityTenantId: text('identity_tenant_id'),
    environment: text('environment').notNull().default('preview'),
    status: text('status').notNull().default('provisioning'),
    desiredState: jsonb('desired_state').notNull().default(sql`'{}'::jsonb`),
    observedState: jsonb('observed_state').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    templateIdx: index('app_instances_template_idx').on(table.templateFamilyId, table.templateVersion),
    tenantIdx: index('app_instances_tenant_idx').on(table.tenantId),
    environmentCheck: check(
      'app_instances_environment_check',
      sql`${table.environment} IN ('prod', 'preview', 'local')`,
    ),
    statusCheck: check(
      'app_instances_status_check',
      sql`${table.status} IN ('provisioning', 'active', 'suspended', 'retired')`,
    ),
  }),
);

export type AppInstanceRow = typeof appInstances.$inferSelect;
export type AppInstanceInsert = typeof appInstances.$inferInsert;

/**
 * control.app_instance_hostnames — host-authoritative routing (BR-45, SPEC §2 Q2).
 *
 * `hostname` is the PRIMARY KEY (globally unique, canonicalized lower-case): one hostname maps
 * to EXACTLY one instance, so a slug/Host mismatch → 404 is DB-guaranteed. Soft ref to the
 * instance (control-namespace rule; integrity is service-enforced).
 */
export const appInstanceHostnames = controlSchema.table(
  'app_instance_hostnames',
  {
    hostname: text('hostname').primaryKey(),
    appInstanceId: text('app_instance_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    instanceIdx: index('app_instance_hostnames_instance_idx').on(table.appInstanceId),
  }),
);

export type AppInstanceHostnameRow = typeof appInstanceHostnames.$inferSelect;
export type AppInstanceHostnameInsert = typeof appInstanceHostnames.$inferInsert;

/**
 * control.app_workspace_bindings — M:N workspace↔instance binding (BR-45, SPEC §2 Q2).
 *
 * `workspace_id` is a SOFT id ref to `public.workspaces` (NO cross-namespace FK). `tenant_id`
 * is denormalized for DD9 composite `(tenant_id, workspace_id)` isolation (re-key pending
 * ARCH-11). One binding per (instance, workspace).
 */
export const appWorkspaceBindings = controlSchema.table(
  'app_workspace_bindings',
  {
    id: text('id').primaryKey(),
    appInstanceId: text('app_instance_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    // ARCH-11 G1a (§4.1.5): DEFAULT-safe default; `identity_tenant_id` is backfilled from the bound
    // workspace's real tenant by control migration 0003.
    tenantId: text('tenant_id').notNull().default('sentropic'),
    identityTenantId: text('identity_tenant_id'),
    allowedWorkspaceTypes: text('allowed_workspace_types').array().notNull().default(sql`'{}'::text[]`),
    defaultWorkspaceTemplate: text('default_workspace_template'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    instanceWorkspaceUnique: uniqueIndex('app_workspace_bindings_instance_workspace_unique').on(
      table.appInstanceId,
      table.workspaceId,
    ),
    tenantWorkspaceIdx: index('app_workspace_bindings_tenant_workspace_idx').on(
      table.tenantId,
      table.workspaceId,
    ),
  }),
);

export type AppWorkspaceBindingRow = typeof appWorkspaceBindings.$inferSelect;
export type AppWorkspaceBindingInsert = typeof appWorkspaceBindings.$inferInsert;

/**
 * control.connector_tenant_enrollments — the durable authorized-tenant-set backing (ARCH-11 G1c,
 * spec §2.1). Scopes, per `(principal_sub, connector_instance_id)`, which real tenant(s) a
 * principal may act on behalf of. Backs the DB-backed `authorizedTenants` resolver
 * (`api/src/services/tenancy/enrollment-store.ts`) and, downstream, the broker grant set (G1d).
 *
 * SOFT references only (control-namespace rule, spec §2.1): `principal_sub` == the token subject
 * (for S2S == `service_clients.client_id`) and `tenant_id` == `public.tenants(id)` are SOFT id
 * refs — NO cross-namespace FK (integrity is service-enforced), matching `app_workspace_bindings`.
 *
 * §1.6 fix: a SINGLE-ORG client resolves its fixed `service_clients.tenant_id` WITHOUT a row here;
 * enrollment rows exist ONLY for multi-org sets. An empty result stays fail-closed upstream.
 */
export const connectorTenantEnrollments = controlSchema.table(
  'connector_tenant_enrollments',
  {
    // Token subject; for S2S == service_clients.client_id (SOFT ref — no cross-namespace FK).
    principalSub: text('principal_sub').notNull(),
    // Scopes the enrollment per connector instance.
    connectorInstanceId: text('connector_instance_id').notNull(),
    // SOFT ref to public.tenants(id) — NO cross-namespace FK.
    tenantId: text('tenant_id').notNull(),
    // active | suspended (quarantine on rollback, spec §4.4).
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    // Composite PK: one row per (principal, connector, tenant).
    pk: primaryKey({
      columns: [table.principalSub, table.connectorInstanceId, table.tenantId],
      name: 'connector_tenant_enrollments_pk',
    }),
    // Resolver lookup: authorizedTenants(principalSub, connectorInstanceId) filtered by status.
    principalConnectorIdx: index('connector_tenant_enrollments_principal_connector_idx').on(
      table.principalSub,
      table.connectorInstanceId,
      table.status,
    ),
    // Client-level lookup (OBO mint): all active enrollments for a principal across connectors.
    principalStatusIdx: index('connector_tenant_enrollments_principal_status_idx').on(
      table.principalSub,
      table.status,
    ),
    statusCheck: check(
      'connector_tenant_enrollments_status_check',
      sql`${table.status} IN ('active', 'suspended')`,
    ),
  }),
);

export type ConnectorTenantEnrollmentRow = typeof connectorTenantEnrollments.$inferSelect;
export type ConnectorTenantEnrollmentInsert = typeof connectorTenantEnrollments.$inferInsert;

/**
 * control.cost_ledger — LLM egress usage/cost record (BR-47 / SPEC_EVOL_LLM_METERING_OBSERVABILITY).
 *
 * Observe-only v0: one row per LLM call, fed by the `@sentropic/llm-mesh` `onResponse` hook via the
 * app-side metering sink (`api/src/services/llm-metering/`). Persistence is app/control-plane owned
 * (ACCOUNT_TRANSPORTS D2: llm-mesh stays DB-agnostic).
 *
 * Guardrails:
 * - Control namespace, NO cross-namespace FK — `userId`/`workspaceId`/`tenantId`/`agentId` etc. are
 *   soft id refs (plain `text`, no `.references()`).
 * - Idempotency: one row per call. `idempotency_key` UNIQUE → the sink inserts with
 *   `ON CONFLICT DO NOTHING`, so a double-fire (retry/replay) is a no-op.
 * - Money: exact micro-USD stored as `bigint` integer (never float); nullable until pricing lands.
 * - Usage columns are all nullable — absent on most provider paths until the usage-envelope lot.
 * - `tenant_id`/`agent_id`/`session_id`/`run_id` are reserved columns; not populated in the MVP
 *   (attribution does not reach the dispatch boundary yet).
 */
export const costLedger = controlSchema.table(
  'cost_ledger',
  {
    id: text('id').primaryKey(),                          // createId()

    // Idempotency — one row per LLM call. UNIQUE → ON CONFLICT DO NOTHING.
    idempotencyKey: text('idempotency_key').notNull(),

    // Attribution (soft refs; nullable = not-in-scope at the dispatch boundary today).
    userId: text('user_id'),
    workspaceId: text('workspace_id'),
    tenantId: text('tenant_id'),                          // reserved; not populated in MVP
    agentId: text('agent_id'),                            // reserved; not populated in MVP
    sessionId: text('session_id'),                        // reserved
    runId: text('run_id'),                                // reserved

    // Call descriptor.
    operation: text('operation').notNull(),               // 'generate' | 'stream'
    providerId: text('provider_id').notNull(),
    modelId: text('model_id').notNull(),
    credentialSource: text('credential_source'),          // ResolvedProviderCredential.source
    finishReason: text('finish_reason'),
    responseId: text('response_id'),                      // provider/app response id (unreliable as key)

    // Usage (all nullable — absent on most paths until the usage-envelope lot).
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    reasoningTokens: integer('reasoning_tokens'),
    totalTokens: integer('total_tokens'),
    usageRaw: jsonb('usage_raw'),                         // TokenUsage.providerRawUsage passthrough

    // Cost (exact micro-USD; nullable until model_pricing exists — later lot).
    costMicroUsd: bigint('cost_micro_usd', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(sql`now()`),
  },
  (table) => ({
    idempotencyUnique: uniqueIndex('cost_ledger_idempotency_key_unique').on(table.idempotencyKey),
    userWorkspaceIdx: index('cost_ledger_user_workspace_idx').on(table.userId, table.workspaceId),
    createdAtIdx: index('cost_ledger_created_at_idx').on(table.createdAt),
    operationCheck: check(
      'cost_ledger_operation_check',
      sql`${table.operation} IN ('generate', 'stream')`,
    ),
  }),
);

export type CostLedgerRow = typeof costLedger.$inferSelect;
export type CostLedgerInsert = typeof costLedger.$inferInsert;
