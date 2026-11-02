/**
 * U1 — activation-store conformance, driver-neutral twin of the shipped
 * `runPostgresActivationConformance` (same vector list, same assertions).
 * Runs against any host supplying a SqliteActivationStore-shaped store; the
 * Postgres lane keeps using the shipped pg-host runner in
 * `src/adapters/postgres-activation-vectors.ts`.
 *
 * Framework-independent (node:assert). Throws on the first failing vector.
 * `wait` is wall-clock for SQLite because the adapter derives expiry from DB
 * time, which advances with real time; the optional client argument exists
 * for hosts that must wait through a leased connection.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { POSTGRES_ACTIVATION_VECTOR_IDS, type PostgresActivationVectorId } from '../../src/adapters/postgres-activation-vectors.js';
import { ActivationCommitUnknownError } from '../../src/adapters/postgres-activation.js';
import type { TicketRecord, TicketStore } from '../../src/content/grants.js';

export interface ActivationFlowBinding {
  subjectId: string; artifactId: string; releaseId: string; channel: 'stable' | 'pinned';
  nonceDigest: string; sessionId: string; profileDigest: string; policyRevision: string; targetOrigin: string;
}
export interface ActivationFlowRecord extends ActivationFlowBinding {
  flowId: string; ticketId: string; expiresAt: number;
}
export interface ActivationFlowStore {
  put(record: ActivationFlowRecord): Promise<void>;
  peek(flowId: string): Promise<ActivationFlowRecord | undefined>;
  remove(flowId: string): Promise<void>;
}
export interface ActivationQueryClient {
  query<T>(text: string, params: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export type ActivationAuthority = (context: {
  client: ActivationQueryClient;
  namespace: string;
  ticket: Readonly<TicketRecord>;
  flow: Readonly<ActivationFlowRecord>;
}) => Promise<boolean>;
export interface ActivationStoreShape {
  tickets: TicketStore;
  flows: ActivationFlowStore;
  consume(input: { flowId: string; ticketId: string; expected: ActivationFlowBinding }, authorize: ActivationAuthority): Promise<TicketRecord | undefined>;
  cleanup(limit?: number): Promise<{ flows: number; tickets: number }>;
  invalidate(): Promise<void>;
}

export interface ActivationConformanceHost {
  createStore(namespace: string): ActivationStoreShape;
  /** Wall-clock wait; client is supplied during authority checks when the host needs it. */
  wait(milliseconds: number, client?: ActivationQueryClient): Promise<void>;
  /** Read persisted issuance/expiry and current DB milliseconds. */
  inspectTicket?(namespace: string, ticketId: string): Promise<{ issuedAt: number; expiresAt: number; now: number }>;
  /** Same host composition, but throw AFTER the consume COMMIT succeeds, losing its acknowledgement. */
  createStoreWithCommitAckLoss?(namespace: string): ActivationStoreShape;
  onPass?(id: PostgresActivationVectorId): void;
}

export async function runActivationConformance(host: ActivationConformanceHost): Promise<PostgresActivationVectorId[]> {
  const passed: PostgresActivationVectorId[] = [];
  for (const id of POSTGRES_ACTIVATION_VECTOR_IDS) {
    const namespace = `upt2:${randomUUID()}`;
    const store = host.createStore(namespace);
    const foreign = host.createStore(`${namespace}:other`);
    const expected = { subjectId: 'alice', artifactId: 'a', releaseId: 'r', channel: 'stable' as const,
      nonceDigest: 'ab'.repeat(32), sessionId: 'session', profileDigest: 'cd'.repeat(32),
      policyRevision: 'p1', targetOrigin: 'https://activation.example.test' };
    async function seed(ttl = 50_000, target: ActivationStoreShape = store) {
      assert.ok(target.tickets.issue, 'DB-time ticket issuance is required');
      const ticket = await target.tickets.issue({ ...expected, ticketId: randomUUID() }, ttl);
      const flow = { ...expected, ticketId: ticket.ticketId, flowId: randomUUID(), expiresAt: ticket.expiresAt };
      await target.flows.put(flow);
      return { ticket, flow, input: { ticketId: ticket.ticketId, flowId: flow.flowId, expected } };
    }
    try {
      const { ticket, flow, input } = await seed();
      const redeem = () => store.consume(input, async () => true);
      const preserved = async () => {
        assert.deepEqual(await store.tickets.peek(ticket.ticketId), ticket);
        assert.deepEqual(await store.flows.peek(flow.flowId), flow);
      };
      if (id === 'namespace-isolation') {
        assert.equal(await foreign.tickets.peek(ticket.ticketId), undefined);
        assert.equal(await foreign.flows.peek(flow.flowId), undefined);
        assert.equal(await foreign.consume(input, async () => true), undefined);
        await foreign.tickets.remove(ticket.ticketId); await preserved();
      } else if (id === 'immutable-records') {
        await assert.rejects(store.tickets.put({ ...ticket, subjectId: 'mallory' }));
        await assert.rejects(store.flows.put({ ...flow, sessionId: 'other' })); await preserved();
      } else if (id === 'binding-mismatch') {
        for (const key of Object.keys(expected)) {
          const mismatch = { ...expected, [key]: key === 'channel' ? 'pinned' : 'different' };
          assert.equal(await store.consume({ ...input, expected: mismatch }, async () => true), undefined, key);
        }
        await preserved(); assert.deepEqual(await redeem(), ticket);
      } else if (id === 'wrong-ids') {
        for (const key of ['ticketId', 'flowId']) {
          assert.equal(await store.consume({ ...input, [key]: randomUUID() }, async () => true), undefined);
        }
        await preserved();
      } else if (id === 'authority-denial') {
        assert.equal(await store.consume(input, async () => false), undefined); await preserved();
      } else if (id === 'authority-outage') {
        const outage = new Error('conformance authority unavailable');
        await assert.rejects(store.consume(input, async () => { throw outage; }), error => error === outage);
        await preserved();
      } else if (id === 'single-use') {
        assert.deepEqual(await redeem(), ticket); assert.equal(await redeem(), undefined);
        assert.equal(await store.flows.peek(flow.flowId), undefined);
      } else if (id === 'concurrent-consume') {
        const replica = host.createStore(namespace);
        const results = await Promise.all([redeem(), replica.consume(input, async () => true)]);
        assert.deepEqual(results.filter(Boolean), [ticket]);
      } else if (id === 'expiry-without-cleanup' || id === 'expiry-after-authority') {
        const expired = await seed(1000);
        if (id === 'expiry-without-cleanup') await host.wait(1200);
        assert.equal(await store.consume(expired.input, async ({ client }) => {
          await host.wait(1200, client); return true;
        }), undefined);
        assert.equal(await store.tickets.peek(expired.ticket.ticketId), undefined);
        assert.equal(await store.flows.peek(expired.flow.flowId), undefined);
      } else if (id === 'bounded-cleanup') {
        for (let i = 0; i < 3; i++) await seed(1000);
        const other = await seed(50_000, foreign); await host.wait(1200);
        let total = 0;
        for (let i = 0; i < 4; i++) {
          const removed = await store.cleanup(2); const count = removed.flows + removed.tickets;
          assert.ok(count >= 0 && count <= 2); total += count;
        }
        assert.equal(total, 6); await preserved();
        assert.deepEqual(await foreign.tickets.peek(other.ticket.ticketId), other.ticket);
      } else if (id === 'invalidation-recovery') {
        await store.invalidate(); const replica = host.createStore(namespace);
        assert.equal(await replica.consume(input, async () => true), undefined);
        assert.equal(await replica.tickets.peek(ticket.ticketId), undefined);
        assert.equal(await replica.flows.peek(flow.flowId), undefined);
        const fresh = await seed(); assert.deepEqual(await replica.consume(fresh.input, async () => true), fresh.ticket);
      } else if (id === 'ttl-cap') {
        for (const ttl of [0, 60_001]) {
          await assert.rejects(store.tickets.issue!({ ...expected, ticketId: randomUUID() }, ttl));
        }
        await seed(60_000);
      } else if (id === 'flow-association') {
        await assert.rejects(store.flows.put({ ...flow, flowId: randomUUID(), subjectId: 'mallory' }));
        await assert.rejects(store.flows.put({ ...flow, flowId: randomUUID(), expiresAt: ticket.expiresAt + 1 }));
      } else if (id === 'db-time-skew') {
        assert.ok(host.inspectTicket, 'inspectTicket hook is required for db-time-skew');
        const originalNow = Date.now;
        try {
          for (const skew of [-120_000, 120_000]) {
            Date.now = () => originalNow() + skew;
            const issued = await seed(60_000);
            const db: { issuedAt: number; expiresAt: number; now: number } =
              await host.inspectTicket(namespace, issued.ticket.ticketId);
            assert.equal(db.expiresAt - db.issuedAt, 60_000);
            assert.equal(issued.ticket.expiresAt, db.expiresAt);
            assert.ok(db.expiresAt - db.now > 59_000 && db.expiresAt - db.now <= 60_000);
            assert.deepEqual(await store.consume(issued.input, async () => true), issued.ticket);
            const expired = await seed(50);
            await host.wait(80);
            assert.equal(await store.consume(expired.input, async () => true), undefined);
            assert.equal(await store.tickets.peek(expired.ticket.ticketId), undefined);
          }
        } finally { Date.now = originalNow; }
      } else if (id === 'commit-unknown') {
        assert.ok(host.createStoreWithCommitAckLoss, 'createStoreWithCommitAckLoss hook is required for commit-unknown');
        const uncertain = host.createStoreWithCommitAckLoss(namespace);
        const grants: unknown[] = [];
        await assert.rejects(uncertain.consume(input, async () => true).then(result => grants.push(result)),
          error => error instanceof ActivationCommitUnknownError);
        assert.deepEqual(grants, []);
        assert.equal(await host.createStore(namespace).consume(input, async () => true), undefined);
        assert.equal(await store.flows.peek(flow.flowId), undefined);
      }
    } catch (cause) { throw new Error(`UP-T conformance failed: ${id}`, { cause }); }
    finally {
      for (const target of [store, foreign]) { await target.invalidate(); await target.cleanup(1000); }
    }
    passed.push(id); host.onPass?.(id);
  }
  return passed;
}
