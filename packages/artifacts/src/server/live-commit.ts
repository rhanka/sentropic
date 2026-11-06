import { randomUUID } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { readLiveOverlay } from './live-drafts.js';
import { applyLiveMutation, liveTreeSha } from './live-tree.js';
import { liveBusy } from './live-mutations.js';
import { liveResponse, type LiveAuthority, type LiveInvocation, type LiveServiceDeps } from './live-contracts.js';
import type { LiveCommand, LiveIdentity } from './live-store.js';

export async function executeLiveCommit(input: { deps: LiveServiceDeps; identity: LiveIdentity;
  authority: LiveAuthority; invocation: LiveInvocation; args: Record<string, any>;
  command: LiveCommand; now: number }): Promise<Record<string, any>> {
  const { deps, identity, authority, invocation, args, command, now } = input;
  if (!args.message.trim() || args.message.length > (deps.gitMessageMaxUnits ?? 16384) ||
    /^Artifacts-(?:Artifact|Invocation|Base):/mi.test(args.message)) throw new ArtifactOperationError('invalid_request');
  const prepared = await deps.store.transaction(identity, async tx => {
    const record = tx.record;
    if (!record) throw new ArtifactOperationError('git_live_no_changes');
    const prior = await tx.receipt(command.actorId, command.key);
    if (prior) {
      if (prior.hash !== command.hash) throw new ArtifactOperationError('command_conflict');
      return { result: { ...prior.result, replayed: true } };
    }
    if (record.pendingCommit && (record.pendingCommit.hash !== command.hash || record.pendingCommit.key !== command.key ||
      record.pendingCommit.actorId !== invocation.actorId)) liveBusy('commit_indeterminate');
    if (!record.pendingCommit && !['DORMANT', 'RUNNING', 'REVIVING'].includes(record.runtime?.phase ?? 'DORMANT')) liveBusy('invalid_phase');
    const overlay = await readLiveOverlay(tx, deps.keys);
    if (record.pendingCommit) return { intent: record.pendingCommit, overlay };
    if (!record.changedPaths) throw new ArtifactOperationError('git_live_no_changes');
    await tx.reserveCommit(invocation.actorId, invocation.invocationId, new Date(now).toISOString());
    const head = await deps.git.resolveRef(authority.target, authority.binding.branch);
    if (args.expectedHeadSha !== head) throw new ArtifactOperationError('git_head_moved',
      { publicDetails: { expectedHeadSha: args.expectedHeadSha, actualHeadSha: head } });
    if (record.baseHeadSha !== head) throw new ArtifactOperationError('git_live_draft_conflict');
    if (!deps.git.snapshot) throw new ArtifactOperationError('capability_unselected');
    const base = await deps.git.snapshot(authority.target, head);
    const candidate = await applyLiveMutation(deps.git, authority.target, base, head, [], args);
    if (liveTreeSha(base, candidate, authority.target) !== record.liveTreeSha || JSON.stringify(candidate) !== JSON.stringify(overlay)) {
      throw new ArtifactOperationError('git_live_snapshot_mismatch');
    }
    record.pendingCommit = { actorId: command.actorId, key: command.key, hash: command.hash,
      invocationId: invocation.invocationId, createdAt: new Date(now).toISOString(), message: args.message,
      expectedHeadSha: head, revision: record.revision, liveTreeSha: record.liveTreeSha };
    return { intent: record.pendingCommit, overlay };
  });
  if (prepared.result) return prepared.result;
  const { intent, overlay } = prepared;
  let committed: { commitSha: string; treeSha: string };
  try {
    const head = await deps.git.resolveRef(authority.target, authority.binding.branch);
    if (head !== intent.expectedHeadSha) {
      const observed = await deps.git.inspectCommit(authority.target, head);
      if (observed.parents.length !== 1 || observed.parents[0] !== intent.expectedHeadSha ||
        observed.treeSha !== intent.liveTreeSha || !observed.message.split('\n').includes(`Artifacts-Invocation: ${intent.invocationId}`)) {
        liveBusy('commit_indeterminate');
      }
      committed = { commitSha: observed.sha, treeSha: observed.treeSha };
    } else committed = await deps.git.commit({ target: authority.target, artifactId: identity.artifactId,
      invocationId: intent.invocationId, createdAt: intent.createdAt, message: intent.message,
      expectedHeadSha: intent.expectedHeadSha, files: overlay.map(({ path, text }) => ({ path, text })),
    });
    if (committed.treeSha !== intent.liveTreeSha) liveBusy('commit_indeterminate');
  } catch (cause) {
    if (cause instanceof ArtifactOperationError && !['provider_unavailable', 'git_live_conflict'].includes(cause.kind)) {
      await deps.store.transaction(identity, async tx => {
        if (tx.record?.pendingCommit?.invocationId === intent.invocationId) tx.record.pendingCommit = null;
      });
    }
    throw cause;
  }
  return deps.store.transaction(identity, async tx => {
    const prior = await tx.receipt(command.actorId, command.key);
    if (prior) return { ...prior.result, replayed: true };
    const record = tx.record!;
    if (record.pendingCommit?.invocationId !== intent.invocationId || record.revision !== intent.revision) liveBusy('stale_fence');
    const current = await deps.authorize(invocation, identity.artifactId);
    if (!current.canReadCode || !current.canWrite || !current.humanLinked || current.ownerId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
    if (current.binding.generation !== identity.bindingGeneration || current.binding.state !== 'attached') liveBusy('stale_fence');
    await tx.advanceBinding?.({ expectedHeadSha: intent.expectedHeadSha, commitSha: committed.commitSha,
      invocationId: intent.invocationId, actorId: invocation.actorId, now: new Date(now).toISOString() });
    Object.assign(record, { revision: randomUUID(), baseHeadSha: committed.commitSha, baseTreeSha: committed.treeSha,
      liveTreeSha: committed.treeSha, objectRef: null, keyVersion: null, digest: null, expiresAt: null,
      changedPaths: 0, draftBytes: 0, tombstone: null, pendingCommit: null,
      latestVerifiedHeadSha: committed.commitSha, progressSeq: record.progressSeq + 1 });
    const result = { ...liveResponse(record, committed.commitSha), revision: record.revision,
      commitSha: committed.commitSha, treeSha: committed.treeSha, parentSha: intent.expectedHeadSha,
      publicationIntent: authority.binding.autoPublish ? 'deferred' : null, replayed: false };
    await tx.complete(command, result);
    return result;
  });
}
