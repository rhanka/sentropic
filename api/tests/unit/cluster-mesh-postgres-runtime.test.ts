import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import {
  clusterMeshCapacityLeases,
  clusterMeshCommands,
  clusterMeshGenerations,
  clusterMeshMcpServers,
  clusterMeshReceipts,
  clusterMeshRegistrations,
  eventOutbox,
} from '../../src/db/control-schema';
import { PostgresClusterMeshRuntimeStore } from '../../src/services/cluster-mesh/postgres-runtime-store';

const store = new PostgresClusterMeshRuntimeStore();
const future = '2026-09-01T00:00:00.000Z';
const past = '2026-08-01T00:00:00.000Z';

async function cleanup() {
  await db.delete(clusterMeshReceipts);
  await db.delete(eventOutbox).where(eq(eventOutbox.aggregateType, 'cluster_mesh_receipt'));
  await db.delete(clusterMeshCommands);
  await db.delete(clusterMeshMcpServers);
  await db.delete(clusterMeshCapacityLeases);
  await db.delete(clusterMeshRegistrations);
  await db.delete(clusterMeshGenerations);
}

async function saveGeneration(status: 'active' | 'lost' = 'active', lease = future) {
  await store.saveGeneration({
    generationId: 'generation-test',
    status,
    supervisorRef: 'supervisor-test',
    supervisorLeaseExpiresAt: lease,
    maxConcurrent: 2,
    poolSize: 1,
  });
}

beforeEach(cleanup);
afterEach(cleanup);

describe('PostgresClusterMeshRuntimeStore', () => {
  it('should persist and resolve an active registration', async () => {
    await saveGeneration();
    await store.saveRegistration({
      registrationId: 'registration-test',
      generationId: 'generation-test',
      principalId: 'nhi-test',
      workspaceId: 'workspace-test',
      custodyEpoch: 4,
      actuatorRef: 'pty:test',
      status: 'active',
      expiresAt: future,
    });

    await expect(store.find('registration-test')).resolves.toEqual({
      registrationId: 'registration-test',
      generationId: 'generation-test',
      principalId: 'nhi-test',
      workspaceId: 'workspace-test',
      custodyEpoch: 4,
      actuatorRef: 'pty:test',
      status: 'active',
      expiresAt: future,
    });
  });

  it('should reclaim capacity after a generation crash', async () => {
    await saveGeneration();
    const lease = (leaseId: string) => ({
      leaseId,
      generationId: 'generation-test',
      subjectRef: leaseId,
      status: 'active' as const,
      expiresAt: future,
      leaseExpiresAt: future,
    });

    await expect(store.reserveCapacity(lease('lease-1'))).resolves.toBe(true);
    await expect(store.reserveCapacity(lease('lease-2'))).resolves.toBe(true);
    await expect(store.reserveCapacity(lease('lease-3'))).resolves.toBe(false);
    await saveGeneration('lost', past);
    await expect(store.reclaimExpiredCapacity('2026-08-30T00:00:00.000Z')).resolves.toBe(2);
    const expired = await db.select().from(clusterMeshCapacityLeases)
      .where(eq(clusterMeshCapacityLeases.status, 'expired'));
    expect(expired).toHaveLength(2);
  });

  it('should enforce one MCP server per generation and command idempotency per target', async () => {
    await saveGeneration();
    await store.saveMcpServer({
      serverId: 'mcp-1',
      generationId: 'generation-test',
      supervisorRef: 'supervisor-1',
      status: 'active',
      leaseExpiresAt: future,
    });
    await store.saveMcpServer({
      serverId: 'mcp-2',
      generationId: 'generation-test',
      supervisorRef: 'supervisor-2',
      status: 'active',
      leaseExpiresAt: future,
    });
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(clusterMeshMcpServers);
    expect(Number(count)).toBe(1);

    const command = (commandId: string, targetRegistrationId: string) => ({
      commandId,
      generationId: 'generation-test',
      targetRegistrationId,
      idempotencyKey: 'idempotency-test',
      action: 'wake' as const,
      status: 'pending' as const,
    });
    await expect(store.enqueueCommand(command('command-1', 'target-1'))).resolves.toBe(true);
    await expect(store.enqueueCommand(command('command-2', 'target-1'))).resolves.toBe(false);
    await expect(store.enqueueCommand(command('command-3', 'target-2'))).resolves.toBe(true);
  });
});
