import { and, eq, sql } from 'drizzle-orm';
import type {
  ClusterMeshRuntimeStore,
  McpSupervisorClaim,
  StoredCapacityLease,
  StoredClusterMeshCommand,
  StoredClusterMeshGeneration,
  StoredMcpServer,
  LocalWorkstationDescriptor,
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
const nullableDate = (value?: string) => value ? date(value) : null;
const WORKSTATION_REF = 'session-workstation:';
export class PostgresClusterMeshRuntimeStore implements ClusterMeshRuntimeStore {
  async saveGeneration(value: StoredClusterMeshGeneration): Promise<void> {
    const row = {
      ...value,
      supervisorLeaseExpiresAt: date(value.supervisorLeaseExpiresAt),
      stoppedAt: nullableDate(value.stoppedAt),
      updatedAt: new Date(),
    };
    const saved = await db.insert(clusterMeshGenerations).values(row).onConflictDoUpdate({
      target: clusterMeshGenerations.generationId,
      set: row,
      setWhere: sql`${clusterMeshGenerations.status} NOT IN ('stopped', 'lost')
        AND ${clusterMeshGenerations.supervisorRef} = ${value.supervisorRef}`,
    }).returning({ generationId: clusterMeshGenerations.generationId });
    if (saved.length === 0) throw new Error('cluster_mesh_generation_fenced');
  }
  async admitWorkstation(value: {
    generationId: string; sessionId: string; ownerSubject: string;
    displayName: string; expiresAt: string;
  }): Promise<void> {
    const result = await db.execute(sql`
      INSERT INTO control.cluster_mesh_registrations
        (registration_id, generation_id, workspace_id, nhi_principal_id,
         custody_holder_principal_id, custody_epoch, actuator_ref, status, expires_at, lease_expires_at)
      SELECT ${`device:${value.sessionId}`}, ${value.generationId}, 'session-admission',
        ${value.ownerSubject}, ${value.ownerSubject}, 0,
        ${WORKSTATION_REF + Buffer.from(value.displayName).toString('base64url')}, 'active',
        ${date(value.expiresAt)}, ${date(value.expiresAt)}
      WHERE EXISTS (SELECT 1 FROM control.cluster_mesh_generations
        WHERE generation_id = ${value.generationId} AND status IN ('starting', 'active')
          AND supervisor_lease_expires_at > now())
      ON CONFLICT (registration_id) DO UPDATE SET expires_at = EXCLUDED.expires_at,
        lease_expires_at = EXCLUDED.lease_expires_at, updated_at = now()
      RETURNING registration_id
    `);
    if (result.rows.length !== 1) throw new Error('cluster_mesh_generation_unavailable');
  }
  async listAdmittedWorkstations(generationId: string): Promise<readonly LocalWorkstationDescriptor[]> {
    const result = await db.execute(sql`
      SELECT registration_id, nhi_principal_id, actuator_ref
      FROM control.cluster_mesh_registrations
      WHERE generation_id = ${generationId} AND status = 'active'
        AND expires_at > now() AND lease_expires_at > now()
        AND actuator_ref LIKE ${WORKSTATION_REF + '%'} ORDER BY registration_id
    `);
    return result.rows.map((row) => ({
      kind: 'workstation' as const,
      deviceId: String(row.registration_id) as `device:${string}`,
      displayName: Buffer.from(String(row.actuator_ref).slice(WORKSTATION_REF.length), 'base64url').toString(),
      ownerSubject: String(row.nhi_principal_id),
      state: 'attached' as const,
    }));
  }
  async saveRegistration(value: Parameters<ClusterMeshRuntimeStore['saveRegistration']>[0]): Promise<void> {
    const row = {
      registrationId: value.registrationId,
      generationId: value.generationId,
      workspaceId: value.workspaceId,
      nhiPrincipalId: value.principalId,
      custodyHolderPrincipalId: value.custodyHolderPrincipalId,
      custodyEpoch: value.custodyEpoch,
      actuatorRef: value.actuatorRef,
      status: value.status,
      expiresAt: date(value.expiresAt),
      leaseExpiresAt: date(value.leaseExpiresAt),
      revokedAt: nullableDate(value.revokedAt),
      lostAt: nullableDate(value.lostAt),
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
      custodyHolderPrincipalId: row.custodyHolderPrincipalId,
      custodyEpoch: row.custodyEpoch,
      actuatorRef: row.actuatorRef,
      status: row.status as 'active' | 'revoked' | 'lost',
      expiresAt: row.expiresAt.toISOString(),
      leaseExpiresAt: row.leaseExpiresAt.toISOString(),
      revokedAt: row.revokedAt?.toISOString(),
      lostAt: row.lostAt?.toISOString(),
    } : null;
  }
  async markRegistrationLost(registrationId: string, lostAt: string): Promise<boolean> {
    const updated = await db.update(clusterMeshRegistrations).set({
      status: 'lost',
      lostAt: date(lostAt),
      updatedAt: date(lostAt),
    }).where(and(
      eq(clusterMeshRegistrations.registrationId, registrationId),
      eq(clusterMeshRegistrations.status, 'active'),
    )).returning({ registrationId: clusterMeshRegistrations.registrationId });
    return updated.length === 1;
  }
  async reserveCapacity(value: StoredCapacityLease) {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${value.generationId}))`);
      const findExisting = async () => {
        const result = await tx.execute(sql`
          SELECT generation_id = ${value.generationId} AND subject_ref = ${value.subjectRef} AS matches,
            status IN ('reserved', 'active') AS active
          FROM control.cluster_mesh_capacity_leases WHERE lease_id = ${value.leaseId}
        `);
        return result.rows[0] as { matches: boolean; active: boolean } | undefined;
      };
      const existing = await findExisting();
      if (existing) {
        return existing.matches && existing.active
          ? { ok: true as const, outcome: 'idempotent_retry' as const }
          : { ok: false as const, reason: 'reservation_conflict' as const };
      }
      const result = await tx.execute(sql`
        INSERT INTO control.cluster_mesh_capacity_leases
          (lease_id, generation_id, subject_ref, status, expires_at, lease_expires_at, released_at)
        SELECT ${value.leaseId}, ${value.generationId}, ${value.subjectRef}, ${value.status},
          ${date(value.expiresAt)}, ${date(value.leaseExpiresAt)}, ${nullableDate(value.releasedAt)}
        WHERE (SELECT count(*) FROM control.cluster_mesh_capacity_leases
          WHERE generation_id = ${value.generationId} AND status IN ('reserved', 'active')
            AND expires_at > now() AND lease_expires_at > now())
          < (SELECT max_concurrent FROM control.cluster_mesh_generations
             WHERE generation_id = ${value.generationId} AND status IN ('starting', 'active'))
        ON CONFLICT DO NOTHING RETURNING lease_id
      `);
      if (result.rows.length === 1) return { ok: true as const, outcome: 'reserved' as const };
      const concurrentRetry = await findExisting();
      if (concurrentRetry) {
        return concurrentRetry.matches && concurrentRetry.active
          ? { ok: true as const, outcome: 'idempotent_retry' as const }
          : { ok: false as const, reason: 'reservation_conflict' as const };
      }
      const generation = await tx.execute(sql`
        SELECT 1 FROM control.cluster_mesh_generations
        WHERE generation_id = ${value.generationId} AND status IN ('starting', 'active')
      `);
      return generation.rows.length === 0
        ? { ok: false as const, reason: 'generation_unavailable' as const }
        : { ok: false as const, reason: 'capacity_exhausted' as const };
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

  async findMcpServer(generationId: string): Promise<StoredMcpServer | null> {
    const [row] = await db.select().from(clusterMeshMcpServers)
      .where(eq(clusterMeshMcpServers.generationId, generationId)).limit(1);
    return row ? {
      serverId: row.serverId,
      generationId: row.generationId,
      supervisorRef: row.supervisorRef,
      status: row.status as StoredMcpServer['status'],
      leaseExpiresAt: row.leaseExpiresAt.toISOString(),
    } : null;
  }

  async claimMcpServer(value: StoredMcpServer, now: string): Promise<McpSupervisorClaim> {
    return db.transaction(async (tx) => {
      const at = date(now);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'mcp:' + value.generationId}))`);
      const [generation] = await tx.select().from(clusterMeshGenerations)
        .where(eq(clusterMeshGenerations.generationId, value.generationId)).limit(1);
      if (!generation) return { ok: false as const, reason: 'missing_registration' as const };
      if (
        !['starting', 'active'].includes(generation.status)
        || generation.supervisorRef !== value.supervisorRef
        || generation.supervisorLeaseExpiresAt <= at
      ) {
        return { ok: false as const, reason: 'stale_registration' as const };
      }
      const [existing] = await tx.select().from(clusterMeshMcpServers)
        .where(eq(clusterMeshMcpServers.generationId, value.generationId)).limit(1);
      if (
        existing
        && existing.status === 'active'
        && existing.leaseExpiresAt > at
        && (existing.serverId !== value.serverId || existing.supervisorRef !== value.supervisorRef)
      ) {
        return { ok: false as const, reason: 'logical_server_exists' as const };
      }
      const row = { ...value, leaseExpiresAt: date(value.leaseExpiresAt), updatedAt: at };
      await tx.insert(clusterMeshMcpServers).values(row).onConflictDoUpdate({
        target: clusterMeshMcpServers.generationId,
        set: row,
      });
      return { ok: true as const };
    });
  }

  async enqueueCommand(value: StoredClusterMeshCommand): Promise<boolean> {
    const inserted = await db.insert(clusterMeshCommands).values({
      ...value,
      actedAt: nullableDate(value.actedAt),
      updatedAt: new Date(),
    })
      .onConflictDoNothing().returning({ commandId: clusterMeshCommands.commandId });
    return inserted.length === 1;
  }

  async updateCommand(
    commandId: string,
    update: Pick<StoredClusterMeshCommand, 'status' | 'refusalReason' | 'actedAt'>,
  ): Promise<boolean> {
    const updated = await db.update(clusterMeshCommands).set({
      status: update.status,
      refusalReason: update.refusalReason ?? null,
      actedAt: nullableDate(update.actedAt),
      updatedAt: new Date(),
    }).where(eq(clusterMeshCommands.commandId, commandId))
      .returning({ commandId: clusterMeshCommands.commandId });
    return updated.length === 1;
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
