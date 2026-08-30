import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
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
const migrationDirectory = '/workspace/api/drizzle/control';

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

    const files = readdirSync(migrationDirectory).filter((file) => /^000[78]_/.test(file));
    expect(files).toEqual(['0007_cluster_mesh_r13.sql']);
    const migration = readFileSync(`${migrationDirectory}/${files[0]}`, 'utf8');
    expect(migration).not.toContain('CREATE TABLE IF NOT EXISTS "control"."event_outbox"');
    expect(migration).toContain('REFERENCES "control"."event_outbox"');
    expect(migration).toContain('Reversible rollback evidence');
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
