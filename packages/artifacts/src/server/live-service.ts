import { randomUUID } from 'node:crypto';
import { GIT_TOOL_DEFINITIONS } from '../git-tool-definitions.js';
import { matchesSchema } from '../profile/validation.js';
import { orderedDigest } from '../profile/json.js';
import { ArtifactOperationError } from './failures.js';
import { isGitSha, gitPath } from './git-port-policy.js';
import { cleanLiveRecord, expireLiveDraft, readLiveOverlay } from './live-drafts.js';
import { validateLiveMutation } from './live-tree.js';
import { readLivePage } from './live-read.js';
import { liveBusy, mutateLive } from './live-mutations.js';
import { executeLiveCommit } from './live-commit.js';
import { settleLiveWorker } from './live-worker.js';
import { liveResponse, type LiveService, type LiveServiceDeps } from './live-contracts.js';
export type * from './live-contracts.js';

export function createLiveService(deps: LiveServiceDeps): LiveService {
  const now = deps.now ?? Date.now;
  return { async execute(operation, raw, invocation) {
    const args = structuredClone(raw) as Record<string, any>;
    if (!['live_write', 'live_read', 'live_reset', 'live_status', 'live_control', 'git_commit'].includes(operation) ||
      !matchesSchema(args, GIT_TOOL_DEFINITIONS[`artifacts_${operation}` as keyof typeof GIT_TOOL_DEFINITIONS].inputSchema)) {
      throw new ArtifactOperationError('invalid_request');
    }
    const writer = !['live_read', 'live_status'].includes(operation);
    const stop = operation === 'live_control' && args.action === 'stop';
    let authority = await deps.authorize(invocation, args.artifactId);
    const { binding } = authority;
    if (authority.target.storageScopeId !== binding.storageScopeId || authority.target.repoId !== binding.repoId ||
      authority.target.branch !== binding.branch || authority.target.subPath !== binding.subPath ||
      authority.target.principalId !== invocation.actorId) throw new ArtifactOperationError('access_denied');
    if (binding.storageScopeId !== invocation.storageScopeId || binding.artifactId !== args.artifactId ||
      (!authority.canReadCode && !stop) || (authority.ownerId !== invocation.actorId &&
        !(operation === 'live_read' && authority.invited && authority.canReadCode))) throw new ArtifactOperationError('access_denied');
    if (writer && (!authority.canWrite || !authority.humanLinked) && !stop) throw new ArtifactOperationError('access_denied');
    if (writer && (!args.idempotencyKey.trim() || args.idempotencyKey.length > (deps.idempotencyKeyMaxUnits ?? 256))) {
      throw new ArtifactOperationError('invalid_request');
    }
    if (operation === 'live_control' && (stop ? !args.liveSessionId || args.expectedHeadSha !== undefined ||
      (authority.canReadCode && !args.expectedLiveRevision) : !args.expectedHeadSha || !args.expectedLiveRevision || args.liveSessionId !== undefined)) {
      throw new ArtifactOperationError('invalid_request');
    }
    if (writer && !stop) {
      if (binding.state === 'paused') throw new ArtifactOperationError('git_binding_paused');
      if (binding.state === 'diverged') throw new ArtifactOperationError('git_diverged');
      if (binding.state === 'detached') throw new ArtifactOperationError('git_not_attached');
      if (binding.state !== 'attached') liveBusy(binding.pendingJobId ? 'pending_publication' : 'invalid_phase');
      if (binding.channel !== 'personal' || binding.personalPrincipalId !== invocation.actorId || binding.executor !== 'sandbox') liveBusy('invalid_phase');
      if ((operation === 'live_write' || operation === 'live_control') && (!authority.qualified || !deps.worker)) throw new ArtifactOperationError('builder_unavailable');
    }
    if (operation === 'live_write' || operation === 'git_commit') validateLiveMutation(authority.repository, authority.target,
      args, 255, operation === 'git_commit' ? 8 * 1024 * 1024 : 2 * 1024 * 1024);
    if (args.paths) {
      if (new Set(args.paths).size !== args.paths.length || args.paths.length > 255) throw new ArtifactOperationError('invalid_request');
      for (const path of args.paths) gitPath(authority.repository, authority.target, path, false);
    }
    let identity = { storageScopeId: invocation.storageScopeId, artifactId: binding.artifactId, bindingGeneration: binding.generation };
    if (stop) {
      const sessionIdentity = await deps.store.sessionIdentity(invocation.storageScopeId, binding.artifactId, args.liveSessionId);
      if (!sessionIdentity) liveBusy('stale_session');
      identity = sessionIdentity!;
    }
    const narrowStop = stop && (!authority.canReadCode || identity.bindingGeneration !== binding.generation);
    const expired = await deps.store.transaction(identity, async tx => expireLiveDraft(tx, now()));
    const command = writer ? { actorId: invocation.actorId, key: args.idempotencyKey,
      hash: orderedDigest({ operation, args }), operation } : undefined;
    if (command) {
      const prior = await deps.store.transaction(identity, tx => tx.receipt(command.actorId, command.key));
      if (prior) {
        if (prior.hash !== command.hash) throw new ArtifactOperationError('command_conflict');
        const runtime = operation === 'live_control' ? await deps.store.transaction(identity, async tx => tx.record?.runtime) : null;
        const liveness = operation !== 'live_control' ? {} : runtime?.liveSessionId === prior.result.liveSessionId ?
          { state: runtime!.phase, runtimeState: runtime!.phase, appliedRevision: runtime!.appliedRevision } :
          { state: 'DORMANT', runtimeState: 'DORMANT', appliedRevision: null };
        return narrowStop ? { liveSessionId: prior.result.liveSessionId, state: liveness.state } :
          { ...prior.result, ...liveness, replayed: true };
      }
    }
    if (expired && !stop && operation !== 'live_reset') {
      const tombstone = await deps.store.transaction(identity, async tx => ({ draftExpiresAt: tx.record?.expiresAt,
        liveRevision: tx.record?.revision, tombstone: true, bindingGeneration: identity.bindingGeneration }));
      throw new ArtifactOperationError('git_live_draft_expired', { publicDetails: tombstone });
    }
    if (writer && !stop && !expired) await deps.store.transaction(identity, async tx => {
      const overlay = await readLiveOverlay(tx, deps.keys);
      if (overlay.length) validateLiveMutation(authority.repository, authority.target, { deletes: overlay.map(e => e.path) });
    });
    if (operation === 'git_commit') return executeLiveCommit({ deps, identity, authority, invocation, args, command: command!, now: now() });
    const head = stop ? binding.headCommitSha! : await deps.git.resolveRef(authority.target, binding.branch);
    if (!stop && !isGitSha(head)) throw new ArtifactOperationError('invalid_request');
    if (args.expectedHeadSha && (!isGitSha(args.expectedHeadSha) || args.expectedHeadSha.length !== head.length)) throw new ArtifactOperationError('invalid_request');
    if (args.expectedHeadSha && args.expectedHeadSha !== head) throw new ArtifactOperationError('git_head_moved',
      { publicDetails: { expectedHeadSha: args.expectedHeadSha, actualHeadSha: head } });
    let action: 'project' | 'stop' | null = null;
    const result = await deps.store.transaction(identity, async tx => {
      const current = await deps.authorize(invocation, args.artifactId);
      if (!stop && current.binding.generation !== identity.bindingGeneration || current.ownerId !== invocation.actorId &&
        !(operation === 'live_read' && current.invited && current.canReadCode) ||
        (!stop && !current.canReadCode)) throw new ArtifactOperationError('access_denied');
      if (writer && !stop && (!current.canWrite || !current.humanLinked || current.binding.state !== 'attached')) throw new ArtifactOperationError('access_denied');
      authority = current;
      if (command) {
        const prior = await tx.receipt(command.actorId, command.key);
        if (prior) {
          if (prior.hash !== command.hash) throw new ArtifactOperationError('command_conflict');
          return { ...prior.result, replayed: true };
        }
      }
      const baseSha = tx.record?.changedPaths ? tx.record.baseHeadSha : head;
      if (!deps.git.snapshot && !stop) throw new ArtifactOperationError('capability_unselected');
      const base = stop ? { treeSha: tx.record?.baseTreeSha ?? '', entries: [] } : await deps.git.snapshot!(authority.target,
        operation === 'live_reset' ? head : baseSha);
      if (!tx.record) tx.record = cleanLiveRecord(identity, head, base.treeSha);
      const record = tx.record;
      if (!stop && operation !== 'live_reset' && record.expiresAt && Date.parse(record.expiresAt) <= now()) throw new ArtifactOperationError('git_live_draft_expired');
      if (!stop && record.latestVerifiedHeadSha !== head) {
        const fastForward = await deps.git.isAncestor(authority.target, record.latestVerifiedHeadSha, head);
        if (!fastForward && writer) throw new ArtifactOperationError('git_diverged');
        if (fastForward) { record.latestVerifiedHeadSha = head; record.progressSeq++; }
      }
      if (!stop && record.baseHeadSha !== head && !record.changedPaths) {
        if (!await deps.git.isAncestor(authority.target, record.baseHeadSha, head)) throw new ArtifactOperationError('git_diverged');
        Object.assign(record, { revision: randomUUID(), baseHeadSha: head, baseTreeSha: base.treeSha, liveTreeSha: base.treeSha,
        });
      }
      if (operation === 'live_reset' && record.baseHeadSha !== head &&
        !await deps.git.isAncestor(authority.target, record.baseHeadSha, head)) throw new ArtifactOperationError('git_diverged');
      const overlay = stop ? [] : operation === 'live_reset' && expired ? [] : await readLiveOverlay(tx, deps.keys);
      if (operation === 'live_read' || operation === 'live_status') return { ...liveResponse(record, head),
        dirty: record.changedPaths > 0, changedPaths: record.changedPaths, draftBytes: record.draftBytes,
        jobId: binding.pendingJobId, publicationIntent: record.progressSeq > record.publicationBaselineSeq && binding.autoPublish ? 'deferred' : null,
        retentionWarning: record.expiresAt && Date.parse(record.expiresAt) - now() < 86400000 ? 'expires_within_24_hours' : null,
        ...(operation === 'live_read' || args.includeDiff || args.cursor ? await readLivePage({ git: deps.git, authority, record,
          overlay, base, args, invocation, kind: operation === 'live_read' ? 'read' : 'diff', now: now() }) : { nextCursor: null }) };
      if (stop && !authority.canReadCode) args.expectedLiveRevision = record.revision;
      const mutation = await mutateLive({ deps, tx, authority, operation, args, base, overlay, currentHeadSha: head, now: now() });
      action = mutation.action;
      await tx.complete(command!, { ...mutation.result, revision: tx.record!.revision });
      return mutation.result;
    });
    if (!result.replayed && action) await settleLiveWorker({ deps, identity, action, result, now: now() });
    return narrowStop ? { liveSessionId: result.liveSessionId, state: result.state } : result;
  } };
}
