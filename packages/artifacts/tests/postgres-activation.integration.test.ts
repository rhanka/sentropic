import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { createPostgresActivationStore } from '../src/adapters/postgres-activation.js';

if (!process.env['DATABASE_URL']) throw new Error('Use make test-artifacts-integration');
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const store = createPostgresActivationStore({ pool, namespace: 'app:test' });
const foreign = createPostgresActivationStore({ pool, namespace: 'radar:test' });
const binding = { subjectId: 'alice', artifactId: 'a', releaseId: 'r', channel: 'stable' as const };
const expected = {
  ...binding, nonceDigest: 'ab'.repeat(32), sessionId: 'session',
  profileDigest: 'cd'.repeat(32), policyRevision: 'p1', targetOrigin: 'https://a.example.test',
};
async function issue(id: string, ttl = 55_000) {
  const ticket = { ...binding, ticketId: id, expiresAt: Date.now() + ttl };
  const flow = { ...expected, ticketId: id, flowId: id, expiresAt: ticket.expiresAt };
  await store.tickets.put(ticket);
  await store.flows.put(flow);
  return { ticket, flow, input: { ticketId: id, flowId: id, expected } };
}
beforeAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifact_host CASCADE');
  await pool.query(readFileSync(new URL('../sql/0001_activation.sql', import.meta.url), 'utf8'));
});
afterAll(async () => {
  await pool.query('DROP SCHEMA IF EXISTS artifact_host CASCADE');
  await pool.end();
});

describe('shared PostgreSQL activation conformance', () => {
  it('should preserve immutable IDs and isolate namespaces', async () => {
    const { ticket, flow } = await issue('immutable');
    await expect(store.tickets.put({ ...ticket, subjectId: 'mallory' })).rejects.toThrow();
    await expect(store.flows.put({ ...flow, sessionId: 'other' })).rejects.toThrow();
    expect(await foreign.tickets.peek(ticket.ticketId)).toBeUndefined();
    expect(await foreign.flows.peek(flow.flowId)).toBeUndefined();
    await foreign.tickets.remove(ticket.ticketId);
    expect(await store.tickets.peek(ticket.ticketId)).toEqual(ticket);
    await expect(store.tickets.put({ ...ticket, ticketId: 'long', expiresAt: Date.now() + 120_000 }))
      .rejects.toThrow();
  });

  it('should preserve both records on every binding mismatch or denial', async () => {
    const { ticket, input } = await issue('bindings');
    for (const key of Object.keys(expected)) {
      const mismatch = { ...expected, [key]: key === 'channel' ? 'pinned' : 'different' };
      expect(await store.consume({ ...input, expected: mismatch }, async () => true)).toBeUndefined();
    }
    expect(await store.consume({ ...input, ticketId: 'other' }, async () => true)).toBeUndefined();
    expect(await store.consume(input, async () => false)).toBeUndefined();
    await expect(store.consume(input, async () => { throw new Error('authority unavailable'); }))
      .rejects.toThrow('authority unavailable');
    expect(await store.tickets.peek(input.ticketId)).toEqual(ticket);
    expect(await store.flows.peek(input.flowId)).toBeDefined();
    expect(await store.consume(input, async () => true)).toEqual(ticket);
    expect(await store.consume(input, async () => true)).toBeUndefined();
  });

  it('should reject cross-ticket bindings and flow deadlines beyond the ticket', async () => {
    const { flow } = await issue('association');
    await expect(store.flows.put({ ...flow, flowId: 'wrong-subject', subjectId: 'bob' })).rejects.toThrow();
    await expect(store.flows.put({ ...flow, flowId: 'long-flow', expiresAt: flow.expiresAt + 1 }))
      .rejects.toThrow();
  });

  it('should race atomically and release its only leased connection', async () => {
    const { input } = await issue('race');
    const single = new Pool({ connectionString: process.env['DATABASE_URL'], max: 1 });
    try {
      const adapter = createPostgresActivationStore({ pool: single, namespace: 'app:test' });
      const results = await Promise.all(Array.from({ length: 8 }, () =>
        adapter.consume(input, async ({ client }) => {
          await client.query('SELECT 1');
          return true;
        })));
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(single.idleCount).toBe(1);
    } finally { await single.end(); }
  });

  it('should deny expired records even when cleanup has stopped', async () => {
    const { input } = await issue('expired', 80);
    await pool.query('SELECT pg_sleep(0.1)');
    expect(await store.tickets.peek(input.ticketId)).toBeUndefined();
    expect(await store.tickets.take(input.ticketId)).toBeUndefined();
    expect(await store.flows.peek(input.flowId)).toBeUndefined();
    expect(await store.consume(input, async () => true)).toBeUndefined();
  });
});
