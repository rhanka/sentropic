import type { Pool, PoolClient } from 'pg';
import type { ExecutionNodeAdapter } from './execution-node-adapter';

/** One advisory-lock holder per node across API replicas; a dedicated DB session owns the lock.
 * Loss of that session stops heartbeats. Agent's five-second fence protects orphaned sandboxes.
 * A follower never adopts an epoch: it uses exactly the same operator-pinned configuration.
 */
export function executionNodeHeartbeat(pool: Pool, node: ExecutionNodeAdapter, alarm: (code: string) => void) {
  let client: PoolClient | undefined; let stopped = true; let verified = false;
  let timer: ReturnType<typeof setTimeout> | undefined; let inFlight: Promise<void> | undefined;
  const lock = `execution-node-heartbeat:${node.config.nodeId}`;
  function discard() {
    const previous = client; client = undefined; verified = false;
    previous?.release(true);
  }
  async function tick() {
    try {
      if (!client) {
        const candidate = await pool.connect();
        if (stopped) { candidate.release(); return; }
        candidate.on('error', discard);
        let result;
        try { result = await candidate.query<{ held: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS held', [lock]); }
        catch (error) { candidate.removeListener('error', discard); candidate.release(true); throw error; }
        if (!result.rows[0]?.held) { candidate.removeListener('error', discard); candidate.release(); return; }
        client = candidate;
      }
      const current = client;
      await current.query('SELECT 1');
      if (stopped || current !== client) return;
      if (!verified) { await node.inspect(); verified = true; }
      if (!stopped && current === client) await node.heartbeat();
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
      stopped = true; clearTimeout(timer); await inFlight;
      const previous = client; client = undefined;
      if (previous) {
        previous.removeListener('error', discard);
        try { await previous.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lock]); previous.release(); }
        catch { previous.release(true); }
      }
    },
  };
}
