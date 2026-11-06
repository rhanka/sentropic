import { ArtifactOperationError } from './failures.js';
import { GitForgeError } from './git-port.js';
import type { GitForge, GitForgeContext, GitHumanDirectory, GitIdentity, GitInstallationLeasePort,
  GitPortRepository, GitPortTarget } from './git-port.js';
import { assertGitTarget } from './git-port-policy.js';

export interface GitPortOptions {
  registry: { get(scope: string, repoId: string): Promise<GitPortRepository | undefined> };
  leases?: GitInstallationLeasePort;
  forge: GitForge;
  directory: GitHumanDirectory;
  committer: GitIdentity;
  /** Current code rights, plus owner-only on writes; host resolves identity and binding. */
  authorize(target: GitPortTarget, write: boolean): Promise<boolean>;
  /** Host-owned stable cursor MAC key; never a forge/App credential. */
  cursorKey: Uint8Array;
  now?: () => number;
  pageSize?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
}
export interface GitPortSession {
  repo: GitPortRepository;
  call<T>(action: (forge: GitForge, context: GitForgeContext) => Promise<T>): Promise<T>;
}
/** A lost receive-pack acknowledgement must be reconciled by SG3, never retried as a new invocation. */
export class GitPortAdvanceUnknown extends ArtifactOperationError {
  readonly commitState = 'unknown';
  constructor() { super('provider_unavailable'); }
}
export function gitSessions(options: GitPortOptions) {
  const invalidated = new Set<string>();
  const key = (target: { storageScopeId: string; repoId: string; installationRef: string }, version: string) =>
    JSON.stringify([target.storageScopeId, target.repoId, target.installationRef, version]);
  async function admit(target: GitPortTarget, write: boolean): Promise<GitPortRepository> {
    if (!await options.authorize(target, write)) throw new ArtifactOperationError('access_denied');
    const repo = await options.registry.get(target.storageScopeId, target.repoId);
    if (!repo) throw new ArtifactOperationError('git_repo_not_registered');
    assertGitTarget(repo, target, write);
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo.locator) || !repo.installationRef) throw new ArtifactOperationError('provider_unavailable');
    return repo;
  }
  async function open(repo: GitPortRepository): Promise<GitPortSession> {
    if (!options.leases) throw new ArtifactOperationError('provider_unavailable');
    let lease;
    try { lease = await options.leases.acquire({ storageScopeId: repo.storageScopeId, repoId: repo.repoId, installationRef: repo.installationRef }); }
    catch (error) {
      // SG0-app errors cross a structural port; never carry their message/body/cause onward.
      throw new ArtifactOperationError((error as { code?: string })?.code === 'access_denied' ? 'access_denied' : 'provider_unavailable');
    }
    const valid = () => lease && typeof lease.token === 'string' && !!lease.token &&
      typeof lease.repositoryId === 'string' && !!lease.repositoryId && typeof lease.credentialVersion === 'string' && !!lease.credentialVersion &&
      Date.parse(lease.expiresAt) > (options.now?.() ?? Date.now()) + 30_000 &&
      lease.permissions?.contents === 'write' && lease.permissions.metadata === 'read' &&
      Object.keys(lease.permissions).length === 2 && !invalidated.has(key(repo, lease.credentialVersion));
    const session: GitPortSession = { repo, async call(action) {
      if (!valid()) throw new ArtifactOperationError('provider_unavailable');
      try { return await action(options.forge, { locator: repo.locator, token: lease.token }); }
      catch (error) {
        if (error instanceof GitForgeError) throw error;
        throw new ArtifactOperationError('provider_unavailable');
      }
    } };
    if (await session.call((forge, context) => forge.repositoryId(context)) !== lease.repositoryId) {
      throw new ArtifactOperationError('access_denied');
    }
    return session;
  }
  return { admit, open, invalidate(input: { storageScopeId: string; repoId: string; installationRef: string; credentialVersion: string }) {
    invalidated.add(key(input, input.credentialVersion));
  } };
}
