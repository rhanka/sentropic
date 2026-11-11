import { expireLiveDraft, persistLiveOverlay, readLiveOverlay } from './live-drafts.js';
import { liveIdentityKey, liveWorkerPending, normalizeRedriveLimit, type LiveIdentity } from './live-store.js';
import type { LiveRedriveItem, LiveServiceDeps, LiveWorkerOutcome } from './live-contracts.js';

const STOP_PHASES = ['QUIESCING', 'SAVING', 'DECOMMISSIONING'];
const LIVE_SETTLE_PHASES = ['REVIVING', 'LIVE'];

const codeOf = (error: unknown): string => {
  const record = error as { kind?: unknown; code?: unknown; name?: unknown } | null;
  if (record) {
    if (typeof record.kind === 'string' && record.kind) return record.kind;
    if (typeof record.code === 'string' && record.code) return record.code;
    if (typeof record.code === 'number') return String(record.code);
    if (typeof record.name === 'string' && record.name && record.name !== 'Error') return record.name;
  }
  return 'unknown';
};
/** A host observer never changes the outcome of a settle. */
function report(deps: LiveServiceDeps, identity: LiveIdentity, action: 'project' | 'stop', outcome: 'failed' | 'pending',
  code?: string, reason?: string) {
  try {
    deps.onWorkerEvent?.({ identity, action, outcome, ...(code ? { code } : {}), ...(reason ? { reason } : {}) });
  } catch { /* observer only */ }
}

/** One settle per identity at a time: a concurrent caller waits for the in-flight attempt instead of
 * doubling the worker call, then runs its own fenced attempt. No parallel reconcile/stop per session. */
const settleLocks = new Map<string, Promise<void>>();
async function withSettleLock<T>(key: string, run: () => Promise<T>): Promise<T> {
  while (settleLocks.has(key)) {
    try { await settleLocks.get(key); } catch { /* locks never reject */ }
  }
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  settleLocks.set(key, current);
  try { return await run(); } finally {
    if (settleLocks.get(key) === current) settleLocks.delete(key);
    release();
  }
}

async function settleOnce(input: { deps: LiveServiceDeps; identity: LiveIdentity;
  action: 'project' | 'stop'; result: Record<string, any>; now: number }): Promise<LiveWorkerOutcome> {
  const { deps, identity, action, result } = input;
  if (!deps.worker) return 'skipped';
  try {
    if (action === 'stop') {
      const runtime = await deps.store.transaction(identity, async tx => tx.record?.runtime);
      const expectedLease = typeof (result as { leaseEpoch?: unknown }).leaseEpoch === 'number'
        ? (result as { leaseEpoch: number }).leaseEpoch : undefined;
      if (!runtime || runtime.liveSessionId !== result.liveSessionId) return 'skipped';
      if (!STOP_PHASES.includes(runtime.phase)) return 'skipped';
      if (expectedLease !== undefined && runtime.leaseEpoch !== expectedLease) return 'skipped';
      await deps.worker.stop({ ...identity, liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch });
      const moved = await deps.store.transaction(identity, async tx => {
        const current = tx.record?.runtime;
        if (!current || current.liveSessionId !== runtime.liveSessionId || current.leaseEpoch !== runtime.leaseEpoch ||
          !STOP_PHASES.includes(current.phase)) return false;
        current.phase = 'DORMANT'; current.appliedRevision = null;
        result.state = 'DORMANT'; result.runtimeState = 'DORMANT'; result.appliedRevision = null;
        return true;
      });
      return moved ? 'settled' : 'skipped';
    }
    const stillProject = await deps.store.transaction(identity, async tx => liveWorkerPending(tx.record) === 'project');
    if (!stillProject) return 'skipped';
    const ack = await deps.worker.reconcile(identity);
    if (!ack) {
      report(deps, identity, action, 'pending');
      return 'pending';
    }
    if (!ack.ready) {
      report(deps, identity, action, 'pending');
      return 'pending';
    }
    const moved = await deps.store.transaction(identity, async tx => {
      const record = tx.record; const runtime = record?.runtime;
      if (!record || !runtime || ack.liveSessionId !== runtime.liveSessionId || ack.leaseEpoch !== runtime.leaseEpoch ||
        ack.routeEpoch !== runtime.routeEpoch || ack.revision !== record.revision || !LIVE_SETTLE_PHASES.includes(runtime.phase)) return false;
      const at = (deps.now ?? Date.now)();
      if (expireLiveDraft(tx, at)) return false;
      if (runtime.renewOnReady && record.changedPaths) {
        const overlay = await readLiveOverlay(tx, deps.keys);
        const renewed = await persistLiveOverlay(tx, deps.keys, { identity, expectedRevision: record.revision,
          baseHeadSha: record.baseHeadSha, baseTreeSha: record.baseTreeSha, liveTreeSha: record.liveTreeSha, overlay }, at, true, true);
        // Source revision remains fenced to the worker ACK; reauthentication is handled by the vault.
        result.draftExpiresAt = renewed.expiresAt;
      }
      runtime.renewOnReady = false; runtime.appliedRevision = ack.revision; runtime.phase = 'LIVE';
      result.appliedRevision = ack.revision; result.workerPending = false; result.runtimeState = 'LIVE'; result.state = 'LIVE';
      return true;
    });
    return moved ? 'settled' : 'skipped';
  } catch (error) {
    // The durable intent remains available to redriveLiveWorkers; the failure is reported, never silent.
    report(deps, identity, action, 'failed', codeOf(error));
    return 'failed';
  }
}

/**
 * Side effects follow durable intents. Failure leaves the accepted source recoverable and pending: the outcome is
 * returned and reported to `deps.onWorkerEvent` (`failed` with the typed code, `pending` for a worker that is not
 * ready yet), and `redriveLiveWorkers` settles the same intent again. Never throws.
 */
export async function settleLiveWorker(input: { deps: LiveServiceDeps; identity: LiveIdentity;
  action: 'project' | 'stop'; result: Record<string, any>; now: number }): Promise<LiveWorkerOutcome> {
  if (!input.deps.worker) return 'skipped';
  return withSettleLock(liveIdentityKey(input.identity), () => settleOnce(input));
}

/**
 * Durable re-drive (host timer, at boot and at most every 60 s): settles again every runtime of the scope that still
 * waits for the worker. A revive whose builder answered `ready: false`, a settle lost with its process and a stop the
 * worker refused are all picked up here; the worker call is the same fenced, idempotent reconcile or stop.
 */
export async function redriveLiveWorkers(deps: LiveServiceDeps, storageScopeId: string, limit?: number): Promise<LiveRedriveItem[]> {
  if (!deps.worker || !deps.store.pending) return [];
  const items: LiveRedriveItem[] = [];
  for (const identity of await deps.store.pending(storageScopeId, normalizeRedriveLimit(limit))) {
    let waiting: { action: 'project' | 'stop'; liveSessionId: string; leaseEpoch: number } | null = null;
    try {
      waiting = await deps.store.transaction(identity, async tx => {
        const action = liveWorkerPending(tx.record);
        return action && tx.record!.runtime
          ? { action, liveSessionId: tx.record!.runtime.liveSessionId, leaseEpoch: tx.record!.runtime.leaseEpoch } : null;
      });
    } catch { waiting = null; }
    if (!waiting) continue;
    const outcome = await settleLiveWorker({ deps, identity, action: waiting.action,
      result: { liveSessionId: waiting.liveSessionId, leaseEpoch: waiting.leaseEpoch }, now: (deps.now ?? Date.now)() })
      .catch(() => 'failed' as const);
    items.push({ ...identity, action: waiting.action, outcome });
  }
  return items;
}
