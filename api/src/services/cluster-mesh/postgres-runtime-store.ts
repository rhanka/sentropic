import { and, eq, sql } from 'drizzle-orm';
import type {
  ClusterMeshRuntimeStore,
  StoredCapacityLease,
  StoredClusterMeshCommand,
  StoredClusterMeshGeneration,
  StoredMcpServer,
} from '@sentropic/cluster-mesh';
import type { InvocationReceipt } from '@sentropic/events';
import { db } from '../../db/client';
import {
  clusterMeshCommands,
  clusterMeshGenerations,
  clusterMeshMcpServers,
  clusterMeshReceipts,
  clusterMeshRegistrations,
  eventOutbox,
} from '../../db/control-schema';
import { outboxWriter } from '../outbox/outbox-writer';
const date = (value: string) => new Date(value);
export class PostgresClusterMeshRuntimeStore implements ClusterMeshRuntimeStore {
  async saveGeneration(value: StoredClusterMeshGeneration): Promise<void> {
    const row = {
      ...value,
      supervisorLeaseExpiresAt: date(value.supervisorLeaseExpiresAt),
      updatedAt: new Date(),
    };
    await db.insert(clusterMeshGenerations).values(row).onConflictDoUpdate({
      target: clusterMeshGenerations.generationId,
      set: row,
    });
  }
  async saveRegistration(value: Parameters<ClusterMeshRuntimeStore['saveRegistration']>[0]): Promise<void> {
    const expiry = date(value.expiresAt);
    const row = {
      registrationId: value.registrationId,
      generationId: value.generationId,
      workspaceId: value.workspaceId,
      nhiPrincipalId: value.principalId,
      custodyHolderPrincipalId: value.principalId,
      custodyEpoch: value.custodyEpoch,
      actuatorRef: value.actuatorRef,
      status: value.status,
      expiresAt: expiry,
      leaseExpiresAt: expiry,
      updatedAt: new Date(),
    };
    await db.insert(clusterMeshRegistrations).values(row).onConflictDoUpdate({
      target: clusterMeshRegistrations.registrationId,
      set: row,
    });
  }
  async find(registrationId: string) {
    const [row] = await db.select().from(clusterMeshRegistrations)
      .where(eq(clusterMeshRegistrations.registrationId, registrationId)).limit(1);
    return row ? {
      registrationId: row.registrationId,
      generationId: row.generationId,
      principalId: row.nhiPrincipalId,
      workspaceId: row.workspaceId,
      custodyEpoch: row.custodyEpoch,
      actuatorRef: row.actuatorRef,
      status: row.status as 'active' | 'revoked' | 'lost',
      expiresAt: row.expiresAt.toISOString(),
    } : null;
  }
  async reserveCapacity(value: StoredCapacityLease): Promise<boolean> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${value.generationId}))`);
      const result = await tx.execute(sql`
        INSERT INTO control.cluster_mesh_capacity_leases
          (lease_id, generation_id, subject_ref, status, expires_at, lease_expires_at)
        SELECT ${value.leaseId}, ${value.generationId}, ${value.subjectRef}, ${value.status},
          ${date(value.expiresAt)}, ${date(value.leaseExpiresAt)}
        WHERE (SELECT count(*) FROM control.cluster_mesh_capacity_leases
          WHERE generation_id = ${value.generationId} AND status IN ('reserved', 'active')
            AND expires_at > now() AND lease_expires_at > now())
          < (SELECT max_concurrent FROM control.cluster_mesh_generations
             WHERE generation_id = ${value.generationId} AND status IN ('starting', 'active'))
        ON CONFLICT DO NOTHING RETURNING lease_id
      `);
      return result.rows.length === 1;
    });
  }
  async reclaimExpiredCapacity(now: string): Promise<number> {
    const result = await db.execute(sql`
      UPDATE control.cluster_mesh_capacity_leases AS lease
      SET status = 'expired', released_at = ${date(now)}, updated_at = ${date(now)}
      WHERE lease.status IN ('reserved', 'active') AND (
        lease.expires_at <= ${date(now)} OR lease.lease_expires_at <= ${date(now)} OR EXISTS (
          SELECT 1 FROM control.cluster_mesh_generations AS generation
          WHERE generation.generation_id = lease.generation_id AND (
            generation.status IN ('stopped', 'lost') OR generation.supervisor_lease_expires_at <= ${date(now)}
          )
        )
      ) RETURNING lease.lease_id
    `);
    return result.rows.length;
  }

  async saveMcpServer(value: StoredMcpServer): Promise<void> {
    const row = { ...value, leaseExpiresAt: date(value.leaseExpiresAt), updatedAt: new Date() };
    await db.insert(clusterMeshMcpServers).values(row).onConflictDoUpdate({
      target: clusterMeshMcpServers.generationId,
      set: row,
    });
  }

  async enqueueCommand(value: StoredClusterMeshCommand): Promise<boolean> {
    const inserted = await db.insert(clusterMeshCommands).values(value)
      .onConflictDoNothing().returning({ commandId: clusterMeshCommands.commandId });
    return inserted.length === 1;
  }

  async append(receipt: InvocationReceipt): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${receipt.receiptId}))`);
      const [existing] = await tx.select({ id: clusterMeshReceipts.receiptId })
        .from(clusterMeshReceipts).where(eq(clusterMeshReceipts.receiptId, receipt.receiptId)).limit(1);
      if (existing) return;
      const seq = await outboxWriter.append(tx, {
        aggregateType: 'cluster_mesh_receipt',
        aggregateId: receipt.invocationId,
        envelope: receipt,
        channel: 'cluster_mesh_receipts',
      });
      const [outbox] = await tx.select({ id: eventOutbox.id }).from(eventOutbox).where(and(
        eq(eventOutbox.aggregateType, 'cluster_mesh_receipt'),
        eq(eventOutbox.aggregateId, receipt.invocationId),
        eq(eventOutbox.seq, seq),
      ));
      if (!outbox) throw new Error('cluster mesh receipt outbox row was not created');
      await tx.insert(clusterMeshReceipts).values({
        ...receipt,
        decision: receipt.stage === 'verified' ? receipt.decision : null,
        refusalReason: receipt.stage === 'verified' ? receipt.reason : null,
        effectRef: receipt.stage === 'acted' ? receipt.effectRef : null,
        outboxEventId: outbox.id,
        occurredAt: date(receipt.occurredAt),
      });
    });
  }
}
