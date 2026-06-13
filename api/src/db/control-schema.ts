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

import { bigint, check, index, integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
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
