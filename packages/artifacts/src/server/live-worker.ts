import { expireLiveDraft, persistLiveOverlay, readLiveOverlay } from './live-drafts.js';
import { liveWorkerPending, type LiveIdentity } from './live-store.js';
import type { LiveRedriveItem, LiveServiceDeps, LiveWorkerOutcome } from './live-contracts.js';

const codeOf = (error: unknown): string => {
  const kind = (error as { kind?: unknown } | null)?.kind;
  return typeof kind === 'string' && kind ? kind : 'unknown';
};
/** A host observer never changes the outcome of a settle. */
function report(deps: LiveServiceDeps, identity: LiveIdentity, action: 'project' | 'stop', outcome: 'failed' | 'pending', code?: string) {
  try { deps.onWorkerEvent?.({ identity, action, outcome, ...(code ? { code } : {}) }); } catch { /* observer only */ }
}

/**
 * Side effects follow durable intents. Failure leaves the accepted source recoverable and pending: the outcome is
 * returned and reported to `deps.onWorkerEvent` (`failed` with the typed code, `pending` for a worker that is not
 * ready yet), and `redriveLiveWorkers` settles the same intent again. Never throws.
 */
export async function settleLiveWorker(input: { deps: LiveServiceDeps; identity: LiveIdentity;
  action: 'project' | 'stop'; result: Record<string, any>; now: number }): Promise<LiveWorkerOutcome> {
  const { deps, identity, action, result } = input;
  if (!deps.worker) return 'skipped';
  try {
    if (action === 'stop') {
      const runtime = await deps.store.transaction(identity, async tx => tx.record?.runtime);
      if (!runtime || runtime.liveSessionId !== result.liveSessionId) return 'skipped';
      await deps.worker.stop({ ...identity, liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch });
      await deps.store.transaction(identity, async tx => {
        if (tx.record?.runtime?.liveSessionId === runtime.liveSessionId && tx.record.runtime.leaseEpoch === runtime.leaseEpoch &&
          ['QUIESCING', 'SAVING', 'DECOMMISSIONING'].includes(tx.record.runtime.phase)) {
          tx.record.runtime.phase = 'DORMANT'; tx.record.runtime.appliedRevision = null;
          result.state = 'DORMANT'; result.runtimeState = 'DORMANT'; result.appliedRevision = null;
        }
      });
      return 'settled';
    }
    const ack = await deps.worker.reconcile(identity);
    if (!ack?.ready) {
      if (ack) report(deps, identity, action, 'pending');
      return ack ? 'pending' : 'skipped';
    }
    await deps.store.transaction(identity, async tx => {
      const record = tx.record; const runtime = record?.runtime;
      if (!record || !runtime || ack.liveSessionId !== runtime.liveSessionId || ack.leaseEpoch !== runtime.leaseEpoch ||
        ack.routeEpoch !== runtime.routeEpoch || ack.revision !== record.revision || !['REVIVING', 'LIVE'].includes(runtime.phase)) return;
      const at = (deps.now ?? Date.now)();
      if (expireLiveDraft(tx, at)) return;
      if (runtime.renewOnReady && record.changedPaths) {
        const overlay = await readLiveOverlay(tx, deps.keys);
        const renewed = await persistLiveOverlay(tx, deps.keys, { identity, expectedRevision: record.revision,
          baseHeadSha: record.baseHeadSha, baseTreeSha: record.baseTreeSha, liveTreeSha: record.liveTreeSha, overlay }, at, true, true);
        // Source revision remains fenced to the worker ACK; reauthentication is handled by the vault.
        result.draftExpiresAt = renewed.expiresAt;
      }
      runtime.renewOnReady = false; runtime.appliedRevision = ack.revision; runtime.phase = 'LIVE';
      result.appliedRevision = ack.revision; result.workerPending = false; result.runtimeState = 'LIVE'; result.state = 'LIVE';
    });
    return 'settled';
  } catch (error) {
    // The durable intent remains available to redriveLiveWorkers; the failure is reported, never silent.
    report(deps, identity, action, 'failed', codeOf(error));
    return 'failed';
  }
}

/**
 * Durable re-drive (host timer, at boot and at most every 60 s): settles again every runtime of the scope that still
 * waits for the worker. A revive whose builder answered `ready: false`, a settle lost with its process and a stop the
 * worker refused are all picked up here; the worker call is the same fenced, idempotent reconcile or stop.
 */
export async function redriveLiveWorkers(deps: LiveServiceDeps, storageScopeId: string, limit = 64): Promise<LiveRedriveItem[]> {
  if (!deps.worker || !deps.store.pending) return [];
  const items: LiveRedriveItem[] = [];
  for (const identity of await deps.store.pending(storageScopeId, limit)) {
    const waiting = await deps.store.transaction(identity, async tx => {
      const action = liveWorkerPending(tx.record);
      return action ? { action, liveSessionId: tx.record!.runtime!.liveSessionId } : null;
    });
    if (!waiting) continue;
    const outcome = await settleLiveWorker({ deps, identity, action: waiting.action,
      result: { liveSessionId: waiting.liveSessionId }, now: (deps.now ?? Date.now)() });
    items.push({ ...identity, action: waiting.action, outcome });
  }
  return items;
}
