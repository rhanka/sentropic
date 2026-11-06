import { createHash, randomUUID } from 'node:crypto';
import { ArtifactOperationError } from './failures.js';
import { createKeyMutex } from './ports.js';
import { isAllowedGitBranch } from './git-registry.js';
import type { GitBinding, GitBindingEvent, GitBindingStore, GitBindingWrite } from './git-contracts.js';
export type * from './git-contracts.js';

export function gitBindingReceiptKey(input: GitBindingWrite): string {
  return 'git-binding:' + createHash('sha256').update(JSON.stringify([
    input.binding.storageScopeId, input.actorId, input.idempotencyKey,
  ])).digest('hex');
}
/** Shared invariants run inside the adapter transaction, after receipt replay and before mutation. */
export function validateGitBindingWrite(before: GitBinding | undefined, input: GitBindingWrite): void {
  const next = input.binding;
  if (!isAllowedGitBranch(next.branch)) throw new ArtifactOperationError('git_ref_not_allowed');
  if (!input.idempotencyKey.trim() || !input.commandHash || !input.actorId || !next.storageScopeId ||
    !next.repoId || next.live !== undefined ||
    !Number.isSafeInteger(next.version) || !Number.isSafeInteger(next.generation) ||
    next.version < 1 || next.generation < 1 ||
    (next.pendingJobId === null) !== (next.pendingCommitSha === null) ||
    (next.channel === 'shared' ? next.personalPrincipalId !== null : !next.personalPrincipalId)) {
    throw new ArtifactOperationError('invalid_request');
  }
  if (before && before.storageScopeId !== next.storageScopeId) throw new ArtifactOperationError('not_found');
  if (input.expectedVersion === null && before) throw new ArtifactOperationError('git_binding_conflict',
    { publicDetails: { artifactId: next.artifactId } });
  if (input.expectedVersion !== (before?.version ?? null)) throw new ArtifactOperationError('pointer_conflict');
  if (next.version !== (before?.version ?? 0) + 1) throw new ArtifactOperationError('invalid_request');
  if (before && before.state !== 'detached' && (next.repoId !== before.repoId || next.branch !== before.branch ||
    next.subPath !== before.subPath)) throw new ArtifactOperationError('git_binding_conflict');
  const action = input.event.action;
  const active = before !== undefined && before.state !== 'detached';
  const transition = action === 'attach' ? (!before || before.state === 'detached') && next.state === 'attached'
    : action === 'pause' ? active && next.state === 'paused'
    : action === 'resume' ? before?.state === 'paused' && next.state === 'attached' &&
      !['git_branch_missing', 'git_diverged'].includes(before.stateDetail ?? '')
    : action === 'detach' ? before !== undefined && next.state === 'detached'
    : action === 'commit' ? before?.state === 'attached' && ['attached', 'build_pending', 'syncing'].includes(next.state)
    : action === 'inbound' ? (before?.state === 'attached' && ['syncing', 'build_pending'].includes(next.state)) ||
      (before?.state === 'syncing' && ['attached', 'build_pending', 'diverged'].includes(next.state)) ||
      (before?.state === 'build_failed' && next.state === 'build_pending') ||
      (active && next.stateDetail === 'git_branch_missing' && next.state === (before.state === 'paused' ? 'paused' : 'diverged'))
    : action === 'publish' ? before !== undefined && (['attached', 'build_failed'].includes(before.state)
      ? next.state === 'build_pending' : before.state === 'build_pending' && ['attached', 'build_failed'].includes(next.state))
    : action === 'conflict' ? active && ['diverged', 'paused'].includes(next.state)
    : action === 'resolve' ? before?.state === 'diverged' && next.state === 'build_pending'
    : action === 'error' && active && next.state === 'error';
  if (!transition) throw new ArtifactOperationError('invalid_request');
  const advance = before && (['attach', 'detach', 'pause'].includes(action) || next.stateDetail === 'git_branch_missing');
  if (next.generation !== (before ? before.generation + (advance ? 1 : 0) : 1) ||
    (advance && (next.pendingJobId !== null || next.pendingCommitSha !== null)) ||
    (before && action !== 'publish' && next.releaseCommitSha !== before.releaseCommitSha)) {
    throw new ArtifactOperationError('invalid_request');
  }
  if (action === 'pause' && before?.state === 'diverged' && next.stateDetail !== (before.stateDetail ?? 'git_diverged')) {
    throw new ArtifactOperationError('invalid_request');
  }
}
export function gitBindingEvent(input: GitBindingWrite): GitBindingEvent {
  return { id: randomUUID(), artifactId: input.binding.artifactId, storageScopeId: input.binding.storageScopeId,
    actorId: input.actorId, action: input.event.action, beforeSha: input.event.beforeSha,
    afterSha: input.event.afterSha, deliveryId: input.event.deliveryId,
    invocationId: input.event.invocationId, createdAt: input.binding.updatedAt };
}

/** Atomic single-process fake tenant. Outputs never expose mutable internal records. */
export function createMemoryGitBindingStore(): GitBindingStore {
  const rows = new Map<string, GitBinding>();
  const audit: GitBindingEvent[] = [];
  const receipts = new Map<string, { hash: string; binding: GitBinding }>();
  const mutex = createKeyMutex();
  return {
    async get(scope, id) {
      const binding = rows.get(id);
      return binding?.storageScopeId === scope ? structuredClone(binding) : undefined;
    },
    async events(scope, id) {
      return structuredClone(audit.filter(event => event.storageScopeId === scope && event.artifactId === id));
    },
    async write(input) {
      const snapshot = structuredClone(input);
      return mutex.runSerialized('git-bindings', async () => {
        const key = gitBindingReceiptKey(snapshot);
        const receipt = receipts.get(key);
        if (receipt) {
          if (receipt.hash !== snapshot.commandHash) throw new ArtifactOperationError('command_conflict');
          return { binding: structuredClone(receipt.binding), replayed: true };
        }
        const binding = snapshot.binding;
        validateGitBindingWrite(rows.get(binding.artifactId), snapshot);
        if (binding.state !== 'detached' && [...rows.values()].some(row => row.artifactId !== binding.artifactId &&
          row.state !== 'detached' && row.repoId === binding.repoId && row.branch === binding.branch)) {
          throw new ArtifactOperationError('git_binding_conflict', { publicDetails: { artifactId: binding.artifactId } });
        }
        rows.set(binding.artifactId, binding);
        audit.push(gitBindingEvent(snapshot));
        receipts.set(key, { hash: snapshot.commandHash, binding: structuredClone(binding) });
        return { binding: structuredClone(binding), replayed: false };
      });
    },
  };
}
