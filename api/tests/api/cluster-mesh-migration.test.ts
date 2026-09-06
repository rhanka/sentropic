import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  clusterMeshCapacityLeases,
  clusterMeshCommands,
  clusterMeshGenerations,
  clusterMeshMcpServers,
  clusterMeshNamespaceCutovers,
  clusterMeshReceipts,
  clusterMeshRegistrations,
} from '../../src/db/control-schema';
import { PostgresClusterMeshCutoverStore } from '../../src/services/cluster-mesh/postgres-cutover-store';

const store = new PostgresClusterMeshCutoverStore();
const defaultMigrationDirectory = fileURLToPath(new URL('../../drizzle/control', import.meta.url));

function readClusterMeshMigration(directory = defaultMigrationDirectory) {
  const files = readdirSync(directory).filter((file) => /^000[78]_/.test(file));
  if (files.length !== 1) throw new Error(`expected one cluster mesh migration, found ${files.length}`);
  return { files, source: readFileSync(`${directory}/${files[0]}`, 'utf8') };
}

function rollbackSection(source: string) {
  const marker = source.indexOf('-- cluster-mesh-r13-down:');
  if (marker < 0) throw new Error('cluster mesh rollback section is missing');
  return source.slice(marker);
}

async function executeRollback(source: string) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('sentropic.cluster_mesh_r13_rollback', 'on', true)`);
    await tx.execute(sql.raw(rollbackSection(source)));
  });
}

async function schemaState() {
  const tables = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'control' AND table_name LIKE 'cluster_mesh_%'
    ORDER BY table_name
  `);
  const indexes = await db.execute(sql`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'control' AND indexname LIKE 'cluster_mesh_%'
    ORDER BY indexname
  `);
  const [{ event_outbox }] = (await db.execute(sql`
    SELECT to_regclass('control.event_outbox') IS NOT NULL AS event_outbox
  `)).rows;
  return {
    tables: tables.rows.map((row) => row.table_name),
    indexes: indexes.rows.map((row) => row.indexname),
    eventOutbox: event_outbox,
  };
}

async function cleanup() {
  await db.delete(clusterMeshReceipts);
  await db.delete(clusterMeshCommands);
  await db.delete(clusterMeshMcpServers);
  await db.delete(clusterMeshCapacityLeases);
  await db.delete(clusterMeshRegistrations);
  await db.delete(clusterMeshNamespaceCutovers);
  await db.delete(clusterMeshGenerations);
}

beforeEach(cleanup);
afterEach(cleanup);

describe('cluster mesh control migration', () => {
  it('should create exactly the seven shared control tables', async () => {
    const result = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'control' AND table_name LIKE 'cluster_mesh_%'
      ORDER BY table_name
    `);
    expect(result.rows.map((row) => row.table_name)).toEqual([
      'cluster_mesh_capacity_leases',
      'cluster_mesh_commands',
      'cluster_mesh_generations',
      'cluster_mesh_mcp_servers',
      'cluster_mesh_namespace_cutovers',
      'cluster_mesh_receipts',
      'cluster_mesh_registrations',
    ]);
    await expect(store.verifyFromEmpty()).resolves.toEqual({
      strategy: 'N-A-from-empty',
      sourceRows: 0,
      migratedRows: 0,
    });
  });

  it('should freeze SG7 keys and indexes in the unique migration', async () => {
    const primaryKey = await db.execute(sql`
      SELECT key_column_usage.column_name
      FROM information_schema.table_constraints
      JOIN information_schema.key_column_usage USING (constraint_name, table_schema, table_name)
      WHERE table_schema = 'control' AND table_name = 'cluster_mesh_namespace_cutovers'
        AND constraint_type = 'PRIMARY KEY'
      ORDER BY key_column_usage.ordinal_position
    `);
    expect(primaryKey.rows.map((row) => row.column_name)).toEqual(['composition_root', 'namespace']);

    const indexes = await db.execute(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'control' AND indexname LIKE 'cluster_mesh_%'
    `);
    const definitions = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]));
    expect(definitions.get('cluster_mesh_registrations_active_lookup_idx')).toContain(
      '(generation_id, workspace_id, nhi_principal_id, status, expires_at, lease_expires_at)',
    );
    expect(definitions.get('cluster_mesh_commands_target_idempotency_unique')).toContain('UNIQUE');
    expect(definitions.get('cluster_mesh_capacity_leases_recovery_idx')).toContain(
      '(generation_id, status, lease_expires_at, expires_at)',
    );
    expect(definitions.get('cluster_mesh_mcp_servers_generation_unique')).toContain('UNIQUE');

    const { files, source: migration } = readClusterMeshMigration();
    expect(files).toEqual(['0007_cluster_mesh_r13.sql']);
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS "control"."event_outbox"');
    expect(migration).toContain('REFERENCES "control"."event_outbox"');
  });

  it('should restore the schema that preceded the unique migration', async () => {
    const { source: migration } = readClusterMeshMigration();
    await executeRollback(migration);
    const before = await schemaState();

    try {
      await db.execute(sql.raw(migration));
      expect((await schemaState()).tables).toHaveLength(7);

      await executeRollback(migration);
      expect(await schemaState()).toEqual(before);
      expect(before).toEqual({ tables: [], indexes: [], eventOutbox: true });
    } finally {
      await db.execute(sql.raw(migration));
    }
  });

  it.each([
    ['cluster_mesh_capacity_leases_status_check', `INSERT INTO control.cluster_mesh_capacity_leases (lease_id, generation_id, subject_ref, status, expires_at, lease_expires_at) VALUES ('check-capacity', 'g', 's', 'invalid', now(), now())`],
    ['cluster_mesh_commands_action_check', `INSERT INTO control.cluster_mesh_commands (command_id, generation_id, target_registration_id, idempotency_key, action, status) VALUES ('check-command-action', 'g', 'r', 'i', 'invalid', 'pending')`],
    ['cluster_mesh_commands_status_check', `INSERT INTO control.cluster_mesh_commands (command_id, generation_id, target_registration_id, idempotency_key, action, status) VALUES ('check-command-status', 'g', 'r', 'i', 'drive', 'invalid')`],
    ['cluster_mesh_generations_status_check', `INSERT INTO control.cluster_mesh_generations (generation_id, status, supervisor_ref, supervisor_lease_expires_at, max_concurrent, pool_size) VALUES ('check-generation-status', 'invalid', 's', now(), 1, 1)`],
    ['cluster_mesh_generations_capacity_check', `INSERT INTO control.cluster_mesh_generations (generation_id, status, supervisor_ref, supervisor_lease_expires_at, max_concurrent, pool_size) VALUES ('check-generation-capacity', 'active', 's', now(), 1, 2)`],
    ['cluster_mesh_mcp_servers_status_check', `INSERT INTO control.cluster_mesh_mcp_servers (server_id, generation_id, supervisor_ref, status, lease_expires_at) VALUES ('check-mcp', 'g', 's', 'invalid', now())`],
    ['cluster_mesh_namespace_cutovers_root_check', `INSERT INTO control.cluster_mesh_namespace_cutovers (composition_root, namespace, selected_generation_id, active_author, status) VALUES ('invalid', '/session', 'g', 'a', 'active')`],
    ['cluster_mesh_namespace_cutovers_status_check', `INSERT INTO control.cluster_mesh_namespace_cutovers (composition_root, namespace, selected_generation_id, active_author, status) VALUES ('product', '/session', 'g', 'a', 'invalid')`],
    ['cluster_mesh_receipts_stage_check', `INSERT INTO control.cluster_mesh_receipts (receipt_id, invocation_id, correlation_id, generation_id, idempotency_key, stage, outbox_event_id, occurred_at) VALUES ('check-receipt-stage', 'i', 'c', 'g', 'k', 'invalid', 'missing', now())`],
    ['cluster_mesh_receipts_decision_check', `INSERT INTO control.cluster_mesh_receipts (receipt_id, invocation_id, correlation_id, generation_id, idempotency_key, stage, decision, outbox_event_id, occurred_at) VALUES ('check-receipt-decision', 'i', 'c', 'g', 'k', 'verified', 'invalid', 'missing', now())`],
    ['cluster_mesh_registrations_status_check', `INSERT INTO control.cluster_mesh_registrations (registration_id, generation_id, workspace_id, nhi_principal_id, custody_holder_principal_id, custody_epoch, actuator_ref, status, expires_at, lease_expires_at) VALUES ('check-registration-status', 'g', 'w', 'n', 'c', 0, 'a', 'invalid', now(), now())`],
    ['cluster_mesh_registrations_custody_epoch_check', `INSERT INTO control.cluster_mesh_registrations (registration_id, generation_id, workspace_id, nhi_principal_id, custody_holder_principal_id, custody_epoch, actuator_ref, status, expires_at, lease_expires_at) VALUES ('check-registration-custody', 'g', 'w', 'n', 'c', -1, 'a', 'active', now(), now())`],
  ])('should enforce %s', async (constraint, statement) => {
    const failure: unknown = await db.execute(sql.raw(statement)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ cause: { constraint } });
  });

  it('should rollback a root-specific namespace author to the previous generation', async () => {
    const key = { compositionRoot: 'product' as const, namespace: '/session' as const };
    await store.activate({
      ...key,
      selectedGenerationId: 'generation-old',
      activeAuthor: 'session-author',
      status: 'active',
      rollbackCheckpoint: { generationId: 'generation-old' },
    });
    await store.activate({
      ...key,
      selectedGenerationId: 'generation-new',
      activeAuthor: 'session-author',
      status: 'active',
      rollbackCheckpoint: { generationId: 'generation-old' },
    });
    expect((await store.find(key))?.previousGenerationId).toBe('generation-old');

    await store.rollback(key, 'generation-old');
    await expect(store.verifyRollback(key)).resolves.toEqual({
      reversible: true,
      selectedGenerationId: 'generation-old',
    });
  });
});
