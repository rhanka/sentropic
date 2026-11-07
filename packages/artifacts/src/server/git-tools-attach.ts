import { createHash } from 'node:crypto';
import { orderedDigest } from '../profile/json.js';
import { ArtifactOperationError } from './failures.js';
import type { GitBinding } from './git-contracts.js';
import { validateGitBindingTarget } from './git-registry.js';
import type { GitPortTarget } from './git-port.js';
import type { GitToolInvocation, GitToolsDeps } from './git-tools-contracts.js';
import { requireOwner } from './git-tools-publish.js';

const FIELDS = ['repoId', 'branch', 'baseRef', 'subPath', 'autoPublish', 'executor', 'pause'];
const id8 = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 8);
const notFound = (error: unknown) => error instanceof ArtifactOperationError && error.kind === 'not_found';

/** G0 v3 §1.2 Tool 3 / A-LIVE S03: attach, configure, pause, resume or detach one binding. */
export async function attachGit(deps: GitToolsDeps, args: Record<string, any>, inv: GitToolInvocation) {
  await requireOwner(deps, inv, args.artifactId, true);
  const scope = inv.storageScopeId;
  const before = await deps.bindings.get(scope, args.artifactId);
  const active = before !== undefined && before.state !== 'detached';
  const given = FIELDS.filter(field => args[field] !== undefined);
  const now = (deps.now?.() ?? new Date()).toISOString();
  const hash = orderedDigest({ operation: 'git_attach', args });
  const write = async (binding: GitBinding, action: 'attach' | 'pause' | 'resume' | 'detach', afterSha?: string) => {
    const out = await deps.bindings.write({ binding, expectedVersion: before?.version ?? null, actorId: inv.actorId,
      idempotencyKey: args.idempotencyKey, commandHash: hash,
      event: { action, beforeSha: before?.headCommitSha ?? undefined, afterSha, invocationId: inv.invocationId } });
    return { artifactId: args.artifactId, git: out.binding, replayed: out.replayed };
  };
  const base = before && { ...before, version: before.version + 1, updatedAt: now };
  if (args.detach !== undefined) {
    if (args.detach !== true || given.length) throw new ArtifactOperationError('invalid_request');
    if (!active) throw new ArtifactOperationError('git_not_attached');
    return write({ ...base!, state: 'detached', generation: before.generation + 1,
      pendingJobId: null, pendingCommitSha: null }, 'detach');
  }
  if (args.pause !== undefined) {
    if (given.length !== 1) throw new ArtifactOperationError('invalid_request');
    if (!active) throw new ArtifactOperationError('git_not_attached');
    if (args.pause) return write({ ...base!, state: 'paused', generation: before.generation + 1,
      pendingJobId: null, pendingCommitSha: null }, 'pause');
    const target = await attachTarget(deps, before, inv);
    await deps.git.resolveRef(target, before.branch).catch(error => {
      throw notFound(error) ? new ArtifactOperationError('git_branch_missing') : error; });
    return write({ ...base!, state: 'attached' }, 'resume');
  }
  const executor: 'caller' | 'ci' | 'sandbox' = args.executor ?? 'caller';
  if (executor !== 'caller' && !(executor === 'sandbox' && await deps.build?.admits('sandbox'))) {
    throw new ArtifactOperationError('builder_unavailable', { publicDetails: { executor,
      reason: executor === 'ci' ? 'executor_retired' : 'executor_unavailable' } });
  }
  if (active) {
    if ((args.repoId ?? before.repoId) !== before.repoId || (args.branch ?? before.branch) !== before.branch ||
      (args.subPath ?? before.subPath) !== before.subPath || executor !== before.executor) {
      throw new ArtifactOperationError('git_binding_conflict', { publicDetails: { artifactId: args.artifactId } });
    }
    const autoPublish = args.autoPublish ?? before.autoPublish;
    if (autoPublish && !before.autoPublish) await assertAutoPublish(deps, before.repoId, before.branch, before.channel, inv);
    return write({ ...base!, autoPublish }, 'attach', before.headCommitSha ?? undefined);
  }
  if (args.repoId === undefined) throw new ArtifactOperationError('invalid_request');
  const principal = id8(`${scope}\0${inv.actorId}`);
  const branch: string = args.branch ?? `artifact/p/${principal}/app-${id8(args.artifactId)}`;
  const subPath: string = args.subPath ?? '';
  const repo = await validateGitBindingTarget(deps.registry, scope, args.repoId, branch, subPath);
  const personal = branch.startsWith('artifact/p/');
  if (personal && !branch.startsWith(`artifact/p/${principal}/`)) throw new ArtifactOperationError('git_ref_not_allowed');
  const channel = personal ? 'personal' : 'shared';
  const target: GitPortTarget = { storageScopeId: scope, repoId: args.repoId, branch, subPath,
    principalId: inv.actorId, outputDir: deps.outputDir ?? 'dist' };
  let head: string; let created = false;
  try { head = await deps.git.resolveRef(target, branch); }
  catch (error) {
    if (!notFound(error)) throw error;
    if (args.baseRef === undefined) throw new ArtifactOperationError('git_branch_missing');
    head = await deps.git.resolveRef(target, args.baseRef);
    await deps.git.createBranch(target, head);
    created = true;
  }
  const defaulted = created && channel === 'personal' && repo.publicationPolicy.delegatedPublication === 'personal-only';
  const autoPublish: boolean = args.autoPublish ?? defaulted;
  if (autoPublish && args.autoPublish === true && !created) {
    throw new ArtifactOperationError('git_auto_publish_refused', { publicDetails: { reason: 'initial_pre_existing_branch' } });
  }
  if (args.autoPublish === true) await assertAutoPublish(deps, args.repoId, branch, channel, inv);
  const binding: GitBinding = { artifactId: args.artifactId, storageScopeId: scope, repoId: args.repoId, branch,
    channel, personalPrincipalId: personal ? inv.actorId : null, subPath, baseCommitSha: head, headCommitSha: head,
    releaseCommitSha: before?.releaseCommitSha ?? null, autoPublish, executor, pendingJobId: null,
    pendingCommitSha: null, state: 'attached', generation: before ? before.generation + 1 : 1,
    version: before ? before.version + 1 : 1, attachedBy: inv.actorId, attachedAt: now, updatedAt: now };
  return write(binding, 'attach', head);
}
async function attachTarget(deps: GitToolsDeps, binding: GitBinding, inv: GitToolInvocation): Promise<GitPortTarget> {
  await validateGitBindingTarget(deps.registry, binding.storageScopeId, binding.repoId, binding.branch, binding.subPath);
  return { storageScopeId: binding.storageScopeId, repoId: binding.repoId, branch: binding.branch,
    subPath: binding.subPath, principalId: inv.actorId, outputDir: deps.outputDir ?? 'dist' };
}
/** OD2 (G0 v3 §1.2): delegated publication is host policy, never a caller claim. */
async function assertAutoPublish(deps: GitToolsDeps, repoId: string, branch: string, channel: string, inv: GitToolInvocation) {
  const repo = await deps.registry.get(inv.storageScopeId, repoId);
  const policy = repo?.publicationPolicy;
  const designated = policy?.sharedPublishers.some(entry => entry.branch === branch &&
    entry.principalIds.includes(inv.actorId));
  const ok = policy?.delegatedPublication === 'personal-only' ? channel === 'personal'
    : policy?.delegatedPublication === 'designated-shared' ? channel === 'personal' || designated === true : false;
  if (!ok) throw new ArtifactOperationError('git_auto_publish_refused', { publicDetails: { reason: 'delegation_policy' } });
}
