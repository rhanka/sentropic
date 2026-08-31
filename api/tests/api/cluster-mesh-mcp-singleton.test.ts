import { createMcpSupervisor } from '@sentropic/cluster-mesh';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { db } from '../../src/db/client';
import {
  clusterMeshGenerations,
  clusterMeshMcpServers,
} from '../../src/db/control-schema';
import { PostgresClusterMeshRuntimeStore } from '../../src/services/cluster-mesh/postgres-runtime-store';

const store = new PostgresClusterMeshRuntimeStore();
const NOW = '2026-08-30T12:00:00.000Z';
const FUTURE = '2026-08-30T13:00:00.000Z';

const cleanup = async () => {
  await db.delete(clusterMeshMcpServers);
  await db.delete(clusterMeshGenerations);
};

const saveGeneration = (generationId: string, supervisorRef: string) => store.saveGeneration({
  generationId,
  status: 'active',
  supervisorRef,
  supervisorLeaseExpiresAt: FUTURE,
  maxConcurrent: 12,
  poolSize: 4,
});

const registration = (serverId = 'server-1') => ({
  serverId,
  generationId: 'generation-1',
  supervisorRef: 'supervisor-1',
  leaseExpiresAt: FUTURE,
});

beforeEach(cleanup);
afterEach(cleanup);

describe('cluster-mesh MCP durable singleton', () => {
  it('keeps one generation-owned server across N logical sessions', async () => {
    await saveGeneration('generation-1', 'supervisor-1');
    const supervisor = createMcpSupervisor({ store, now: () => new Date(NOW) });
    await expect(supervisor.register(registration())).resolves.toMatchObject({ ok: true });

    for (let session = 0; session < 25; session += 1) {
      await expect(supervisor.authorize('generation-1', 'supervisor-1')).resolves.toMatchObject({ ok: true });
    }
    await expect(supervisor.register({ ...registration(), sessionRef: 'session-25' })).resolves.toEqual({
      ok: false,
      reason: 'session_server_forbidden',
    });
    const rows = await db.select().from(clusterMeshMcpServers);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      generationId: 'generation-1',
      serverId: 'server-1',
      supervisorRef: 'supervisor-1',
    });
  });

  it('refuses missing registration and a second logical server before effects', async () => {
    const supervisor = createMcpSupervisor({ store, now: () => new Date(NOW) });
    await expect(supervisor.register(registration())).resolves.toEqual({
      ok: false,
      reason: 'missing_registration',
    });
    await saveGeneration('generation-1', 'supervisor-1');
    await supervisor.register(registration());
    await expect(supervisor.register(registration('server-2'))).resolves.toEqual({
      ok: false,
      reason: 'logical_server_exists',
    });
  });

  it.each(['stopped', 'lost'] as const)('refuses to resurrect a %s generation', async (status) => {
    await saveGeneration('generation-1', 'supervisor-1');
    await store.saveGeneration({
      generationId: 'generation-1',
      status,
      supervisorRef: 'supervisor-1',
      supervisorLeaseExpiresAt: NOW,
      maxConcurrent: 12,
      poolSize: 4,
      stoppedAt: NOW,
    });

    await expect(saveGeneration('generation-1', 'supervisor-1'))
      .rejects.toThrow('cluster_mesh_generation_terminal');
    const [generation] = await db.select().from(clusterMeshGenerations)
      .where(eq(clusterMeshGenerations.generationId, 'generation-1'));
    expect(generation).toMatchObject({ status });
  });

  it('persists generation handover rollback to the previous author', async () => {
    await saveGeneration('generation-1', 'supervisor-1');
    await saveGeneration('generation-2', 'supervisor-2');
    const supervisor = createMcpSupervisor({ store, now: () => new Date(NOW) });
    await supervisor.register(registration());
    const handover = await supervisor.handover({
      fromGenerationId: 'generation-1',
      to: {
        serverId: 'server-2',
        generationId: 'generation-2',
        supervisorRef: 'supervisor-2',
        leaseExpiresAt: FUTURE,
      },
    });
    expect(handover).toMatchObject({ ok: true });
    if (!handover.ok) throw new Error('handover unexpectedly failed');
    await expect(supervisor.rollback(handover.checkpoint)).resolves.toMatchObject({ ok: true });
    await expect(store.findMcpServer('generation-1')).resolves.toMatchObject({ status: 'active' });
    await expect(store.findMcpServer('generation-2')).resolves.toMatchObject({ status: 'stopped' });
  });
});
