import type { Pool } from 'pg';
import { LiveError, type LiveKey } from './records';

/** Phases whose memory peaks stack on a node: cold revive and wake (offline install + Vite pre-bundle), crash restore,
 * and the clean idle or explicit build. A live HMR projection is never a heavy phase and never waits here. */
export type LiveHeavyPhase = 'revive' | 'wake' | 'crash_restore' | 'idle_build' | 'explicit_build';
/** One heavy phase at a time per builder node (r3.5: one d2-4 node packs four live pods). */
export interface LiveHeavyGate {
  /** FIFO wait up to the host bound, then `builder_unavailable`/`queued`; the slot frees when `work` settles. */
  run<T>(key: LiveKey, phase: LiveHeavyPhase, work: () => Promise<T>): Promise<T>;
}
const queued = () => new LiveError('builder_unavailable', 'queued');

/** Process-local gate, valid for one API replica. */
export function createHeavyGate(options: { maxWaitMs: number }): LiveHeavyGate {
  let busy = false; const waiting: Array<() => void> = [];
  const release = () => { const next = waiting.shift(); if (next) next(); else busy = false; };
  return {
    async run(_key, _phase, work) {
      if (busy) {
        await new Promise<void>((resolve, reject) => {
          const grant = () => { clearTimeout(timer); resolve(); };
          const timer = setTimeout(() => {
            const index = waiting.indexOf(grant); if (index >= 0) waiting.splice(index, 1); reject(queued());
          }, options.maxWaitMs);
          timer.unref?.(); waiting.push(grant);
        });
      } else busy = true;
      try { return await work(); } finally { release(); }
    },
  };
}

/** Replica-safe gate: a session advisory lock per node on a dedicated connection. Postgres grants waiters in order;
 * the connection is always destroyed afterwards, so a crashed API or a failed unlock can never leak the lock. */
export function createPostgresHeavyGate(pool: Pool, options: { node: string; maxWaitMs: number }): LiveHeavyGate {
  const lock = `artifact-live-heavy/v1:${options.node}`;
  return {
    async run(_key, _phase, work) {
      const client = await pool.connect();
      try {
        await client.query("SELECT set_config('lock_timeout', $1, false)", [`${options.maxWaitMs}ms`]);
        try { await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [lock]); }
        catch (error) { if ((error as { code?: string }).code === '55P03') throw queued(); throw error; }
        return await work();
      } finally { client.release(true); }
    },
  };
}

/** `work` tears down its own failures INSIDE the gate, so the next heavy phase never overlaps a process tree that is
 * still terminating. `refused` runs only when the gate refused before `work` started. */
export async function gated<T>(gate: LiveHeavyGate, key: LiveKey, phase: LiveHeavyPhase,
  refused: (error: unknown) => Promise<void>, work: () => Promise<T>): Promise<T> {
  let entered = false;
  try { return await gate.run(key, phase, () => { entered = true; return work(); }); }
  catch (error) { if (!entered) await refused(error); throw error; }
}
