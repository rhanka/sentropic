import { describe, expect, it } from 'vitest';

import {
  createMcpSupervisor,
  type McpSupervisorClaim,
  type McpSupervisorStore,
  type StoredMcpServer,
} from '../src/index.js';

const NOW = '2026-08-30T12:00:00.000Z';
const FUTURE = '2026-08-30T13:00:00.000Z';
const PAST = '2026-08-30T11:00:00.000Z';

class MemoryStore implements McpSupervisorStore {
  readonly generations = new Map<string, { supervisorRef: string; leaseExpiresAt: string }>();
  readonly servers = new Map<string, StoredMcpServer>();

  async findMcpServer(generationId: string) {
    return this.servers.get(generationId) ?? null;
  }

  async claimMcpServer(server: StoredMcpServer, now: string): Promise<McpSupervisorClaim> {
    const generation = this.generations.get(server.generationId);
    if (!generation) return { ok: false, reason: 'missing_registration' };
    if (generation.supervisorRef !== server.supervisorRef || generation.leaseExpiresAt <= now) {
      return { ok: false, reason: 'stale_registration' };
    }
    const existing = this.servers.get(server.generationId);
    if (existing && existing.status === 'active' && existing.leaseExpiresAt > now) {
      return existing.serverId === server.serverId && existing.supervisorRef === server.supervisorRef
        ? { ok: true }
        : { ok: false, reason: 'logical_server_exists' };
    }
    this.servers.set(server.generationId, server);
    return { ok: true };
  }

  async saveMcpServer(server: StoredMcpServer) {
    this.servers.set(server.generationId, server);
  }
}

const registeredStore = () => {
  const store = new MemoryStore();
  store.generations.set('generation-1', { supervisorRef: 'supervisor-1', leaseExpiresAt: FUTURE });
  return store;
};

const registration = (serverId = 'server-1') => ({
  serverId,
  generationId: 'generation-1',
  supervisorRef: 'supervisor-1',
  leaseExpiresAt: FUTURE,
});

describe('MCP logical supervisor', () => {
  it('keeps one logical server per generation and zero server ownership per session', async () => {
    const store = registeredStore();
    const supervisor = createMcpSupervisor({ store, now: () => new Date(NOW) });

    await expect(supervisor.register(registration())).resolves.toMatchObject({ ok: true });
    await expect(supervisor.register(registration('server-2'))).resolves.toEqual({
      ok: false,
      reason: 'logical_server_exists',
    });
    await expect(supervisor.register({ ...registration(), sessionRef: 'session-1' })).resolves.toEqual({
      ok: false,
      reason: 'session_server_forbidden',
    });
    for (let session = 0; session < 20; session += 1) {
      await expect(supervisor.authorize('generation-1', 'supervisor-1')).resolves.toMatchObject({ ok: true });
    }
    expect(store.servers.size).toBe(1);
  });

  it('refuses missing and stale generation registrations before server creation', async () => {
    const store = new MemoryStore();
    const supervisor = createMcpSupervisor({ store, now: () => new Date(NOW) });

    await expect(supervisor.register(registration())).resolves.toEqual({
      ok: false,
      reason: 'missing_registration',
    });
    store.generations.set('generation-1', { supervisorRef: 'supervisor-1', leaseExpiresAt: PAST });
    await expect(supervisor.register(registration())).resolves.toEqual({
      ok: false,
      reason: 'stale_registration',
    });
    expect(store.servers.size).toBe(0);
  });

  it('rolls a generation handover back to the previous author', async () => {
    const store = registeredStore();
    store.generations.set('generation-2', { supervisorRef: 'supervisor-2', leaseExpiresAt: FUTURE });
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
    expect(store.servers.get('generation-1')?.status).toBe('stopped');
    if (!handover.ok) throw new Error('handover unexpectedly failed');
    await expect(supervisor.rollback(handover.checkpoint)).resolves.toMatchObject({ ok: true });
    expect(store.servers.get('generation-1')?.status).toBe('active');
    expect(store.servers.get('generation-2')?.status).toBe('stopped');
  });
});
