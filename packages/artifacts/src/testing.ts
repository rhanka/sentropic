/**
 * L3 (immo #861) — test-only commit barrier (spec r2 §3.2).
 *
 * Test seam for pausing finalization at deterministic points with
 * invocation correlation. `waitUntilReached` resolves after arrival;
 * `release` resumes only that invocation/point pair. The coordinator
 * rechecks authority after a resumed barrier; a barrier can never mark
 * an operation authorized or successful.
 *
 * Pass `observer` as the coordinator `testObserver`. Register a wait before
 * starting the operation to pause that invocation/point; other arrivals
 * are observed without blocking. The three preparation points are fired by L4
 * preparation adapters holding this same observer, never by the
 * coordinator (arming one throws at construction).
 */
export const COMMIT_BARRIER_POINTS = [
  'before_connection_acquire',
  'before_key_lock',
  'before_blob_put',
  'after_blob_put_before_verify',
  'before_blob_readback',
  'before_finalization_row_lock',
  'after_finalization_locks_before_guard',
  'after_replay_lookup_before_guard',
  'before_commit',
] as const;

export type CommitBarrierPoint = (typeof COMMIT_BARRIER_POINTS)[number];

export type CommitBarrierObserver = (
  point: CommitBarrierPoint, invocationId: string,
) => Promise<void>;

export interface CommitArrivalObserver {
  arrive(point: CommitBarrierPoint, invocationId: string): void;
}

interface BarrierGate {
  arrivals: number;
  armed: boolean;
  waiters: Array<() => void>;
  releases: Array<() => void>;
}

/** Create a correlated test barrier for one finalization run. */
export function createArtifactCommitBarrier(options?: { readonly points: readonly CommitBarrierPoint[] }): {
  observer: CommitBarrierObserver & CommitArrivalObserver;
  waitUntilReached(point: CommitBarrierPoint, invocationId: string): Promise<void>;
  release(point: CommitBarrierPoint, invocationId: string): void;
} {
  const gates = new Map<string, BarrierGate>();
  const gateFor = (point: CommitBarrierPoint, invocationId: string): BarrierGate => {
    const key = `${point}:${invocationId}`;
    const existing = gates.get(key);
    if (existing !== undefined) return existing;
    const created: BarrierGate = { arrivals: 0, armed: options?.points.includes(point) ?? false, waiters: [], releases: [] };
    gates.set(key, created);
    return created;
  };
  const arrive = (point: CommitBarrierPoint, invocationId: string): Promise<void> => {
    const gate = gateFor(point, invocationId);
    gate.arrivals += 1;
    for (const waiter of gate.waiters.splice(0)) waiter();
    if (!gate.armed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      gate.releases.push(resolve);
    });
  };
  return {
    observer: Object.assign(arrive, { arrive }),
    waitUntilReached: (point, invocationId) => {
      const gate = gateFor(point, invocationId);
      if (gate.arrivals > 0) return Promise.resolve();
      gate.armed = true;
      return new Promise<void>((resolve) => {
        gate.waiters.push(resolve);
      });
    },
    release: (point, invocationId) => {
      const gate = gateFor(point, invocationId);
      const resume = gate.releases.shift();
      if (resume === undefined) throw new Error(`no paused barrier at ${point} for ${invocationId}`);
      resume();
    },
  };
}
