import { randomUUID } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { persistLiveOverlay } from './live-drafts.js';
import { applyLiveMutation, liveTreeSha, type LiveBaseTree, type LiveMutation } from './live-tree.js';
import { liveResponse, type LiveAuthority, type LiveServiceDeps } from './live-contracts.js';
import type { LiveOverlayEntry, LiveTransaction } from './live-store.js';

export const liveBusy = (reason: import('./live-errors.js').LiveConflictReason): never => {
  throw new ArtifactOperationError('git_live_conflict', { publicDetails: { reason } });
};
export async function mutateLive(input: { deps: LiveServiceDeps; tx: LiveTransaction; authority: LiveAuthority;
  operation: string; args: Record<string, any>; base: LiveBaseTree; overlay: LiveOverlayEntry[];
  currentHeadSha: string; now: number }): Promise<{ result: Record<string, any>; action: 'project' | 'stop' | null }> {
  const { deps, tx, authority, operation, args, base, overlay, currentHeadSha, now } = input;
  let record = tx.record!;
  if (args.expectedLiveRevision !== record.revision) throw new ArtifactOperationError('git_live_revision_moved');
  const phase = record.runtime?.phase ?? 'DORMANT';
  let action: 'project' | 'stop' | null = null;
  if (operation === 'live_control' && args.action === 'stop') {
    if (args.liveSessionId !== record.runtime?.liveSessionId) liveBusy('stale_session');
    record.runtime!.phase = 'DECOMMISSIONING'; record.runtime!.routeEpoch++;
    action = 'stop';
  } else {
    if (record.pendingCommit) liveBusy('commit_indeterminate');
    if (!['DORMANT', 'RUNNING', 'REVIVING'].includes(phase)) liveBusy('invalid_phase');
    if (operation !== 'live_reset' && record.baseHeadSha !== currentHeadSha && record.changedPaths) {
      throw new ArtifactOperationError('git_live_draft_conflict');
    }
    if (operation === 'live_write') {
      const next = await applyLiveMutation(deps.git, authority.target, base, record.baseHeadSha, overlay, args as LiveMutation);
      if (JSON.stringify(next) === JSON.stringify(overlay)) throw new ArtifactOperationError('git_live_no_changes');
      const touched = new Set([...(args.files ?? []).map((f: any) => f.path), ...(args.edits ?? []).map((f: any) => f.path)]);
      const resultingBytes = next.filter(e => touched.has(e.path)).reduce((n, e) => n + Buffer.byteLength(e.text ?? ''), 0);
      if (resultingBytes > 2 * 1024 * 1024 || next.length > Math.min(255, deps.commitPathsMax ?? 255) ||
        next.reduce((n, e) => n + Buffer.byteLength(e.text ?? ''), 0) > Math.min(8 * 1024 * 1024, deps.commitBytesMax ?? 8 * 1024 * 1024)) {
        throw new ArtifactOperationError('limit_exceeded');
      }
      record = await persistLiveOverlay(tx, deps.keys, { identity: record, expectedRevision: record.revision,
        baseHeadSha: record.baseHeadSha, baseTreeSha: record.baseTreeSha,
        liveTreeSha: liveTreeSha(base, next, authority.target), overlay: next }, now);
      action = 'project';
    } else if (operation === 'live_reset') {
      for (const entry of overlay) {
        // Validation happened before any GitPort call; no unadmitted saved path is projected.
        if (!entry.path) throw new ArtifactOperationError('git_path_refused');
      }
      Object.assign(record, { revision: randomUUID(), baseHeadSha: currentHeadSha, baseTreeSha: base.treeSha,
        liveTreeSha: base.treeSha, objectRef: null, keyVersion: null, digest: null,
        expiresAt: null, changedPaths: 0, draftBytes: 0, tombstone: 'reset' });
      if (phase !== 'DORMANT') action = 'project';
    } else {
      if (phase !== 'DORMANT' && !(phase === 'REVIVING' && record.runtime?.origin === 'implicit')) liveBusy('active_session');
      action = 'project';
    }
    if (action === 'project') {
      if (!record.runtime || phase === 'DORMANT') record.runtime = { liveSessionId: randomUUID(), phase: 'REVIVING',
        leaseEpoch: (record.runtime?.leaseEpoch ?? 0) + 1, routeEpoch: (record.runtime?.routeEpoch ?? 0) + 1,
        appliedRevision: null, lastAccessAt: new Date(now).toISOString(), pendingWake: false,
        origin: operation === 'live_control' ? 'explicit' : 'implicit' };
      if (operation === 'live_control') record.runtime.renewOnReady = true;
      if (operation === 'live_write') record.runtime.lastAccessAt = new Date(now).toISOString();
    }
  }
  return { action, result: { ...liveResponse(record, currentHeadSha), state: record.runtime?.phase ?? 'DORMANT',
    replayed: false, workerPending: record.runtime?.appliedRevision !== record.revision } };
}
