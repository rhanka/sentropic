import type { Pool } from 'pg';
import { emptyHeavyPhaseQueueState, type HeavyPhaseKind, type HeavyPhaseQueue, type HeavyPhaseQueueState,
  type HeavyPhaseQueueStore } from '@sentropic/cluster-mesh';
import type { CachePorts } from './cache';
import type { LiveStore } from './ports';
import { podName } from './pods';
import { LiveError } from './records';

/** Phases whose memory peaks stack on a node: the in-pod install, the Vite pre-bundle, the dev server start (which
 * becomes the live reservation) and the clean build. A live HMR projection is never a heavy phase and never waits. */
export type LiveHeavyPhase = HeavyPhaseKind;
/** Client of the cluster-mesh heavy-phase queue of one builder node; subjects are pod names. */
export interface LiveHeavyGate {
  /** Waits in strict FIFO (renewing its ticket) until the node budget admits the phase, runs `work`, then frees the
   * ticket; a finished `dev` with `live` becomes the pod's live reservation. Past the wait bound it throws
   * `builder_unavailable`/`queued` and leaves the queue, unless `keep` (a durable waiter re-requesting every pass). */
  run<T>(subject: string, phase: LiveHeavyPhase, work: () => Promise<T>,
    options?: { waitMs?: number; keep?: boolean; live?: boolean }): Promise<T>;
  hold(subject: string, holds: { pod?: boolean; live?: boolean }): Promise<void>;
  /** Drops every ticket of the pod (teardown, wake). */
  cancel(subject: string): Promise<void>;
  /** The pod's admitted or queued phases, for the live status surface. */
  status(subject: string): Promise<Array<{ kind: LiveHeavyPhase; state: 'admitted' | 'queued'; position: number }>>;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Before its first decision the gate replaces the node's pod and live holds from `holds()` (every runtime that is not
 * DORMANT has a pod; LIVE ones hold a live reservation), so the budget survives an API restart. */
export function createQueuedHeavyGate(options: { queue: HeavyPhaseQueue; node: string; maxWaitMs: number; pollMs: number;
  renewMs: number; holds(): Promise<{ pods: string[]; lives: string[] }> }): LiveHeavyGate {
  const { queue, node } = options;
  const running = new Set<string>(); // one in-process runner per ticket: a second one would finish the first one's ticket
  let seeded: Promise<void> | undefined;
  const seed = () => seeded ??= options.holds().then(holds => queue.seed(node, holds))
    .catch(error => { seeded = undefined; throw error; });
  return {
    async run(subject, phase, work, run = {}) {
      await seed();
      const ticket = { subject, kind: phase }; const id = `${phase}:${subject}`;
      if (running.has(id)) throw new LiveError('builder_unavailable', 'queued');
      running.add(id);
      try { return await admitted(ticket, work, run); } finally { running.delete(id); }
    },
    async hold(subject, holds) { await seed(); await queue.hold(node, { subject, ...holds }); },
    async cancel(subject) { await seed(); await queue.cancel(node, subject); },
    async status(subject) {
      await seed();
      return (await queue.status(node)).entries.filter(entry => entry.subject === subject)
        .map(({ kind, state, position }) => ({ kind, state, position }));
    },
  };
  async function admitted<T>(ticket: { subject: string; kind: LiveHeavyPhase }, work: () => Promise<T>,
    run: { waitMs?: number; keep?: boolean; live?: boolean }) {
    for (let waited = 0; (await queue.request(node, ticket)).state !== 'admitted'; waited += options.pollMs) {
      if (waited >= (run.waitMs ?? options.maxWaitMs)) {
        if (!run.keep) await queue.finish(node, ticket);
        throw new LiveError('builder_unavailable', 'queued');
      }
      await delay(options.pollMs);
    }
    // Renewals are chained and drained before `finish`, so a late renewal can never re-enqueue a finished ticket.
    let renewing: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => { renewing = renewing.then(() => queue.request(node, ticket)).catch(() => undefined); },
      options.renewMs);
    let live = false;
    try { const result = await work(); live = run.live === true; return result; }
    finally {
      clearInterval(timer); await renewing;
      // A lost live reservation would over-admit the node, so only that failure propagates; others expire by TTL.
      try { await queue.finish(node, { ...ticket, live }); } catch (error) { if (live) throw error; }
    }
  }
}
export async function liveHolds(store: Pick<LiveStore, 'active'>) {
  const active = await store.active();
  return { pods: active.map(({ key }) => podName(key)), lives: active.filter(({ phase }) => phase === 'LIVE').map(({ key }) => podName(key)) };
}
/** The in-pod clean install is the `install` heavy phase; an install outside a pod is not a node phase. */
export const gatedInstall = (heavy: LiveHeavyGate, install: CachePorts['cleanInstall']): CachePorts['cleanInstall'] =>
  input => input.runtime ? heavy.run(input.runtime.podName, 'install', () => install(input)) : install(input);

const QUEUE_NAMESPACE = 'artifact-live-heavy-queue/v1';
/** Durable queue state of one node in the existing host KV migration, serialized by a node lock across replicas. */
export function createPostgresHeavyQueueStore(pool: Pool): HeavyPhaseQueueStore {
  return {
    async transaction(node, work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${QUEUE_NAMESPACE}:${node}`]);
        const { rows } = await client.query<{ value: string }>(
          'SELECT value FROM control.artifact_host_kv WHERE storage_scope_id=$1 AND key=$2 FOR UPDATE', [QUEUE_NAMESPACE, node]);
        const state = rows[0] ? JSON.parse(rows[0].value) as HeavyPhaseQueueState : emptyHeavyPhaseQueueState();
        const result = work(state);
        await client.query(`INSERT INTO control.artifact_host_kv (storage_scope_id, key, value) VALUES ($1,$2,$3)
          ON CONFLICT (storage_scope_id,key) DO UPDATE SET value=EXCLUDED.value`, [QUEUE_NAMESPACE, node, JSON.stringify(state)]);
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
}
