import { and, eq, sql } from 'drizzle-orm';
import type {
  ClusterMeshBackfillPort,
  ClusterMeshCutoverStore,
  ClusterMeshRollbackVerificationPort,
  NamespaceCutoverKey,
  NamespaceCutoverRecord,
} from '@sentropic/cluster-mesh';
import { db } from '../../db/client';
import { clusterMeshNamespaceCutovers } from '../../db/control-schema';

export class PostgresClusterMeshCutoverStore implements
  ClusterMeshCutoverStore,
  ClusterMeshBackfillPort,
  ClusterMeshRollbackVerificationPort {
  async find(key: NamespaceCutoverKey): Promise<NamespaceCutoverRecord | null> {
    const [row] = await db.select().from(clusterMeshNamespaceCutovers).where(and(
      eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
      eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
    )).limit(1);
    return row ? {
      compositionRoot: row.compositionRoot as NamespaceCutoverKey['compositionRoot'],
      namespace: row.namespace as NamespaceCutoverKey['namespace'],
      selectedGenerationId: row.selectedGenerationId,
      previousGenerationId: row.previousGenerationId ?? undefined,
      activeAuthor: row.activeAuthor,
      status: row.status as NamespaceCutoverRecord['status'],
      shadowComparison: row.shadowComparison ?? undefined,
      rollbackCheckpoint: row.rollbackCheckpoint ?? undefined,
    } : null;
  }

  async activate(record: NamespaceCutoverRecord): Promise<void> {
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(clusterMeshNamespaceCutovers).where(and(
        eq(clusterMeshNamespaceCutovers.compositionRoot, record.compositionRoot),
        eq(clusterMeshNamespaceCutovers.namespace, record.namespace),
      )).limit(1);
      const row = {
        ...record,
        previousGenerationId: record.previousGenerationId ?? current?.selectedGenerationId ?? null,
        shadowComparison: record.shadowComparison ?? null,
        rollbackCheckpoint: record.rollbackCheckpoint ?? null,
        activatedAt: record.status === 'active' ? new Date() : null,
        updatedAt: new Date(),
      };
      await tx.insert(clusterMeshNamespaceCutovers).values(row).onConflictDoUpdate({
        target: [
          clusterMeshNamespaceCutovers.compositionRoot,
          clusterMeshNamespaceCutovers.namespace,
        ],
        set: row,
      });
    });
  }

  async rollback(key: NamespaceCutoverKey, selectedGenerationId: string): Promise<void> {
    const current = await this.find(key);
    if (!current?.rollbackCheckpoint) throw new Error('cluster mesh rollback checkpoint is missing');
    await db.update(clusterMeshNamespaceCutovers).set({
      selectedGenerationId,
      previousGenerationId: current.selectedGenerationId,
      status: 'rolled_back',
      updatedAt: new Date(),
    }).where(and(
      eq(clusterMeshNamespaceCutovers.compositionRoot, key.compositionRoot),
      eq(clusterMeshNamespaceCutovers.namespace, key.namespace),
    ));
  }

  async verifyFromEmpty() {
    const result = await db.execute(sql`
      SELECT (SELECT count(*) FROM control.cluster_mesh_generations)
        + (SELECT count(*) FROM control.cluster_mesh_registrations)
        + (SELECT count(*) FROM control.cluster_mesh_capacity_leases)
        + (SELECT count(*) FROM control.cluster_mesh_mcp_servers)
        + (SELECT count(*) FROM control.cluster_mesh_commands)
        + (SELECT count(*) FROM control.cluster_mesh_receipts)
        + (SELECT count(*) FROM control.cluster_mesh_namespace_cutovers) AS total
    `);
    if (Number(result.rows[0]?.total) !== 0) {
      throw new Error('N-A-from-empty requires empty cluster mesh control tables');
    }
    return { strategy: 'N-A-from-empty' as const, sourceRows: 0 as const, migratedRows: 0 as const };
  }

  async verifyRollback(key: NamespaceCutoverKey) {
    const record = await this.find(key);
    return {
      reversible: record?.status === 'rolled_back' && Boolean(record.rollbackCheckpoint),
      selectedGenerationId: record?.selectedGenerationId,
    };
  }
}
