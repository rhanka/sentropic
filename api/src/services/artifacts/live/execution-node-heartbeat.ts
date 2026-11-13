import type { Pool, PoolClient } from 'pg';
import type { ExecutionNodeAdapter } from './execution-node-adapter';

/** One advisory-lock holder per node across API replicas; a dedicated DB session owns the lock.
 * Loss of that session stops heartbeats. Agent's five-second fence protects orphaned sandboxes.
 * A follower never adopts an epoch: it uses exactly the same operator-pinned configuration.
 */
export function executionNodeHeartbeat(pool: Pool, node: ExecutionNodeAdapter, alarm: (code: string) => void) {
  const bound = async <T>(work: Promise<T>, ms: number): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('heartbeat_operation_timeout')), ms);
    })]); } finally { clearTimeout(timeout); }
  };
  let client: PoolClient | undefined; let stopped = true; let verified = false;
  let abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined; let inFlight: Promise<void> | undefined;
  const lock = `execution-node-heartbeat:${node.config.nodeId}`;
  function discard() {
    abort.abort();
    const previous = client; client = undefined; verified = false;
    previous?.removeListener('error', discard);
    previous?.release(true);
  }
  async function tick() {
    try {
      if (!client) {
        let expired = false;
        const connecting = pool.connect().then(candidate => {
          if (expired) { candidate.release(true); throw new Error('heartbeat_connect_expired'); }
          return candidate;
        });
        let candidate;
        try { candidate = await bound(connecting, 300); } catch (error) { expired = true; throw error; }
        if (stopped) { candidate.release(); return; }
        abort = new AbortController(); client = candidate;
        candidate.on('error', discard);
        let result;
        result = await bound(candidate.query<{ held: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held', [lock]), 300);
        if (!result.rows[0]?.held) { client = undefined; candidate.removeListener('error', discard); candidate.release(); return; }
      }
      const current = client;
      if (!current) return;
      await bound(current.query('SELECT 1'), 300);
      if (stopped || current !== client) return;
      if (!verified) {
        await bound(node.inspect(abort.signal), 500);
        if (stopped || current !== client || abort.signal.aborted) return;
        verified = true;
      }
      if (!stopped && current === client) await bound(node.heartbeat(abort.signal), 500);
    } catch (error) {
      if (error instanceof Error && error.message === 'execution_node_identity_mismatch') stopped = true;
      alarm('execution_node_heartbeat_failed'); discard();
    }
  }
  function schedule() {
    if (stopped) return;
    const start = Date.now();
    inFlight = tick().finally(() => {
      if (!stopped) { timer = setTimeout(schedule, Math.max(0, 1000 - (Date.now() - start))); timer.unref(); }
    });
  }
  return {
    start() { if (stopped) { stopped = false; schedule(); } return this; },
    async stop() {
      stopped = true; clearTimeout(timer); discard(); await inFlight;
    },
  };
}
