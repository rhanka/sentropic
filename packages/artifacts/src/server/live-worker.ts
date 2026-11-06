import { expireLiveDraft, persistLiveOverlay, readLiveOverlay } from './live-drafts.js';
import type { LiveIdentity } from './live-store.js';
import type { LiveServiceDeps } from './live-contracts.js';

/** Side effects follow durable intents. Failure leaves the accepted source recoverable and pending. */
export async function settleLiveWorker(input: { deps: LiveServiceDeps; identity: LiveIdentity;
  action: 'project' | 'stop'; result: Record<string, any>; now: number }): Promise<void> {
  const { deps, identity, action, result, now } = input;
  if (!deps.worker) return;
  try {
    if (action === 'stop') {
      const runtime = await deps.store.transaction(identity, async tx => tx.record?.runtime);
      if (!runtime || runtime.liveSessionId !== result.liveSessionId) return;
      await deps.worker.stop({ ...identity, liveSessionId: runtime.liveSessionId, leaseEpoch: runtime.leaseEpoch });
      await deps.store.transaction(identity, async tx => {
        if (tx.record?.runtime?.liveSessionId === runtime.liveSessionId && tx.record.runtime.leaseEpoch === runtime.leaseEpoch &&
          ['QUIESCING', 'SAVING', 'DECOMMISSIONING'].includes(tx.record.runtime.phase)) {
          tx.record.runtime.phase = 'DORMANT'; tx.record.runtime.appliedRevision = null;
          result.state = 'DORMANT'; result.runtimeState = 'DORMANT'; result.appliedRevision = null;
        }
      });
    } else {
      const ack = await deps.worker.reconcile(identity);
      if (!ack?.ready) return;
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
    }
  } catch { /* The durable intent remains available to the controller's fenced reconciliation. */ }
}
