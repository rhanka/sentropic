import { ArtifactOperationError } from './failures.js';
import { assertGitSha } from './git-port-policy.js';
import type { GitPortTarget } from './git-port.js';
import { orderedDigest } from '../profile/json.js';
import type { GitToolInvocation, GitToolsDeps } from './git-tools-contracts.js';

/** Owner + host write scope + current code right; refusals carry no git detail. */
export async function requireOwner(deps: GitToolsDeps, inv: GitToolInvocation, artifactId: string, write: boolean) {
  const authority = await deps.authorize(inv, artifactId);
  if (authority.ownerId !== inv.actorId || (write && !authority.canWrite)) throw new ArtifactOperationError('access_denied');
}
/** Current repository code right (G0 v3 §1.4); a port failure is a denial. Runs before any registry or forge call. */
export async function requireCodeRight(deps: GitToolsDeps, inv: GitToolInvocation, repoId: string) {
  const allowed = await deps.codeRights.canReadCode({ storageScopeId: inv.storageScopeId, repoId, actorId: inv.actorId })
    .then(value => value === true, () => false);
  if (!allowed) throw new ArtifactOperationError('access_denied');
}
/** G0 v3 §2.6 git_publish: pin one reachable SHA, persist the build job, move the binding to build_pending. */
export async function publishGit(deps: GitToolsDeps, args: Record<string, any>, inv: GitToolInvocation) {
  await requireOwner(deps, inv, args.artifactId, true);
  assertGitSha(args.commitSha);
  const scope = inv.storageScopeId;
  const binding = await deps.bindings.get(scope, args.artifactId);
  if (!binding || binding.state === 'detached') throw new ArtifactOperationError('git_not_attached');
  await requireCodeRight(deps, inv, binding.repoId);
  if (binding.state === 'paused') throw new ArtifactOperationError('git_binding_paused', { publicDetails: { state: 'paused' } });
  if (binding.state === 'diverged') throw new ArtifactOperationError('git_diverged', {
    publicDetails: { headCommitSha: binding.headCommitSha, releaseCommitSha: binding.releaseCommitSha } });
  if (binding.state === 'build_pending' && binding.pendingCommitSha === args.commitSha) {
    return { artifactId: args.artifactId, jobId: binding.pendingJobId, state: 'build_pending', commitSha: args.commitSha, replayed: true };
  }
  if (!['attached', 'build_failed'].includes(binding.state)) {
    throw new ArtifactOperationError('git_binding_conflict', { publicDetails: { artifactId: args.artifactId } });
  }
  const build = deps.build;
  if (!build) throw new ArtifactOperationError('provider_unavailable');
  if (!await build.admits(binding.executor)) throw new ArtifactOperationError('builder_unavailable', {
    publicDetails: { executor: binding.executor, reason: 'executor_unavailable' } });
  const target: GitPortTarget = { storageScopeId: scope, repoId: binding.repoId, branch: binding.branch,
    subPath: binding.subPath, principalId: inv.actorId, outputDir: deps.outputDir ?? 'dist' };
  const head = await deps.git.resolveRef(target, binding.branch);
  if (head !== args.commitSha && !await deps.git.isAncestor(target, args.commitSha, head)) {
    throw new ArtifactOperationError('git_sha_not_on_branch', { publicDetails: { commitSha: args.commitSha } });
  }
  const job = await build.request({ storageScopeId: scope, artifactId: args.artifactId, repoId: binding.repoId,
    branch: binding.branch, subPath: binding.subPath, commitSha: args.commitSha, bindingGeneration: binding.generation,
    expectedCurrentReleaseId: args.expectedCurrentReleaseId, executor: binding.executor, requestedBy: inv.actorId,
    idempotencyKey: args.idempotencyKey });
  const now = (deps.now?.() ?? new Date()).toISOString();
  const out = await deps.bindings.write({
    binding: { ...binding, state: 'build_pending', headCommitSha: head, pendingJobId: job.jobId,
      pendingCommitSha: args.commitSha, version: binding.version + 1, updatedAt: now },
    expectedVersion: binding.version, actorId: inv.actorId, idempotencyKey: args.idempotencyKey,
    commandHash: orderedDigest({ operation: 'git_publish', args }),
    event: { action: 'publish', beforeSha: binding.releaseCommitSha ?? undefined, afterSha: args.commitSha,
      invocationId: inv.invocationId } });
  return { artifactId: args.artifactId, jobId: out.binding.pendingJobId ?? job.jobId, state: out.binding.state,
    commitSha: args.commitSha, replayed: out.replayed };
}
