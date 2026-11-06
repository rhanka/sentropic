import { ArtifactOperationError } from './failures.js';

export interface GitRepository {
  repoId: string;
  storageScopeId: string;
  forge: 'github-app' | 'git-ssh';
  locator: string;
  installationRef: string;
  webhookSecretRef: string;
  branchPrefix: 'artifact/';
  allowedSubPaths: string[];
  writablePaths: string[];
  refusedWritePaths: string[];
  publicationPolicy: {
    personalBranchPrefix: 'artifact/p/';
    sharedPublishers: { branch: string; principalIds: string[]; designationRef: string }[];
    delegatedPublication: 'none' | 'personal-only' | 'designated-shared';
  };
  canWrite: boolean;
  codePolicyRef: string;
}
export interface GitRepositoryRegistry {
  get(storageScopeId: string, repoId: string): Promise<GitRepository | undefined>;
}
export type GitRepositoryInput = Omit<GitRepository, 'publicationPolicy' | 'canWrite' | 'writablePaths' | 'refusedWritePaths'> & {
  publicationPolicy?: Partial<GitRepository['publicationPolicy']>;
  canWrite?: boolean;
  writablePaths?: string[];
  refusedWritePaths?: string[];
};
/** Host-only registry. No enrollment/credential material is accepted by any tool. */
export function createGitRepositoryRegistry(entries: readonly GitRepositoryInput[]): GitRepositoryRegistry {
  const records = new Map<string, GitRepository>();
  for (const input of entries) {
    const policy = input.publicationPolicy;
    const record: GitRepository = structuredClone({ ...input, canWrite: input.canWrite ?? false,
      writablePaths: input.writablePaths ?? [], refusedWritePaths: input.refusedWritePaths ?? [],
      publicationPolicy: { personalBranchPrefix: 'artifact/p/', sharedPublishers: [],
        ...policy, delegatedPublication: policy?.delegatedPublication ?? 'none' } });
    const key = JSON.stringify([record.storageScopeId, record.repoId]);
    if (!record.repoId || !record.storageScopeId || record.branchPrefix !== 'artifact/' ||
      record.publicationPolicy.personalBranchPrefix !== 'artifact/p/' ||
      !['none', 'personal-only', 'designated-shared'].includes(record.publicationPolicy.delegatedPublication) ||
      records.has(key)) throw new ArtifactOperationError('invalid_request');
    records.set(key, record);
  }
  return { async get(scope, repoId) {
    const record = records.get(JSON.stringify([scope, repoId]));
    return record === undefined ? undefined : structuredClone(record);
  } };
}
/** Git ref grammar, restricted to the host namespace; accepts branch names, never refs/heads aliases. */
export function isAllowedGitBranch(branch: string): boolean {
  return branch.startsWith('artifact/') && !/[\x00-\x20\x7f~^:?*\[\\]/.test(branch) &&
    !branch.includes('..') && !branch.includes('@{') && !branch.endsWith('.') &&
    branch.split('/').every(part => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'));
}
export async function validateGitBindingTarget(registry: GitRepositoryRegistry, scope: string,
  repoId: string, branch: string, subPath: string): Promise<GitRepository> {
  const record = await registry.get(scope, repoId);
  if (!record || record.storageScopeId !== scope) throw new ArtifactOperationError('git_repo_not_registered');
  if (!record.canWrite || !isAllowedGitBranch(branch) || !record.allowedSubPaths.includes(subPath) ||
    (subPath !== '' && subPath.split('/').some(part => !part || part === '.' || part === '..')) ||
    subPath.includes('\\') || subPath.includes('\0')) throw new ArtifactOperationError('git_ref_not_allowed');
  return record;
}
