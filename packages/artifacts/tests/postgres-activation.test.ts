import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  ActivationCommitUnknownError, createPostgresActivationStore,
} from '../src/adapters/postgres-activation.js';

const ticket = {
  ticketId: 't', subjectId: 's', artifactId: 'a', releaseId: 'r',
  channel: 'stable' as const, expiresAt: Date.now() + 55_000,
};
const expected = {
  subjectId: 's', artifactId: 'a', releaseId: 'r', channel: 'stable' as const,
  nonceDigest: 'ab'.repeat(32), sessionId: 'session', profileDigest: 'cd'.repeat(32),
  policyRevision: 'p1', targetOrigin: 'https://a.example.test',
};
const flow = { ...expected, flowId: 'f', ticketId: 't', expiresAt: ticket.expiresAt };
const input = { flowId: 'f', ticketId: 't', expected };

function world(commit: () => Promise<unknown> = async () => ({ rows: [] })) {
  const release = vi.fn();
  const query = vi.fn(async (sql: string) => {
    if (sql === 'COMMIT') return commit();
    if (sql.includes('SELECT generation')) return { rows: [{ generation: '1' }] };
    if (sql.includes('browser_flows')) return { rows: [{ payload: flow }], rowCount: 1 };
    if (sql.includes('activation_tickets')) return { rows: [{ payload: ticket }], rowCount: 1 };
    return { rows: [] };
  });
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  return { store: createPostgresActivationStore({ pool: { connect } as unknown as Pool, namespace: 'test' }),
    query, release, connect };
}

describe('PostgreSQL activation commit boundary', () => {
  it('should perform no I/O at construction and reject an invalid namespace', () => {
    const w = world();
    expect(w.connect).not.toHaveBeenCalled();
    for (const namespace of ['', 'x\u0000y', '\ud800']) {
      expect(() => createPostgresActivationStore({ pool: {} as Pool, namespace })).toThrow();
    }
  });

  it('should return no consumable result before COMMIT is acknowledged', async () => {
    let acknowledge!: (value: unknown) => void;
    let committing!: () => void;
    const started = new Promise<void>(resolve => { committing = resolve; });
    const w = world(() => { committing(); return new Promise(resolve => { acknowledge = resolve; }); });
    const cookie = vi.fn();
    const result = w.store.consume(input, async () => true).then(cookie);
    await started;
    expect(cookie).not.toHaveBeenCalled();
    acknowledge({ rows: [] });
    await result;
    expect(cookie).toHaveBeenCalledWith(ticket);
    expect(w.connect).toHaveBeenCalledTimes(1);
    expect(w.release).toHaveBeenCalledTimes(1);
  });

  it('should issue no grant on uncertain COMMIT and destroy the connection', async () => {
    const cause = new Error('lost acknowledgement');
    const w = world(async () => { throw cause; });
    const cookie = vi.fn();
    const result = w.store.consume(input, async () => true).then(cookie);
    await expect(result).rejects.toBeInstanceOf(ActivationCommitUnknownError);
    await expect(result).rejects.toMatchObject({ cause });
    expect(cookie).not.toHaveBeenCalled();
    expect(w.release).toHaveBeenCalledWith(true);
  });

  it('should retain the primary failure if rollback fails', async () => {
    const w = world();
    w.query.mockImplementation(async sql => {
      if (sql === 'ROLLBACK') throw new Error('rollback lost');
      if (sql.includes('SELECT generation')) return { rows: [{ generation: '1' }] } as never;
      throw new Error('primary failure');
    });
    await expect(w.store.tickets.peek('t')).rejects.toThrow('primary failure');
    expect(w.release).toHaveBeenCalledWith(true);
  });
});
