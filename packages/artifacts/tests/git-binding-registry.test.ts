import { describe, expect, it } from 'vitest';
import { createGitRepositoryRegistry, validateGitBindingTarget } from '../src/server/git-registry.js';

const repository = { repoId: 'repo-a', storageScopeId: 'scope-a', forge: 'github-app' as const,
  locator: 'host/repository', installationRef: 'enrollment-ref', webhookSecretRef: 'verification-ref',
  branchPrefix: 'artifact/' as const, allowedSubPaths: [''], writablePaths: [], refusedWritePaths: [],
  codePolicyRef: 'repo-code-policy' };
describe('host git repository registry', () => {
  it('should default to no write and no delegated publication and isolate scopes', async () => {
    const registry = createGitRepositoryRegistry([repository]);
    expect(await registry.get('scope-a', 'repo-a')).toMatchObject({ canWrite: false,
      publicationPolicy: { delegatedPublication: 'none', personalBranchPrefix: 'artifact/p/', sharedPublishers: [] } });
    expect(await registry.get('scope-b', 'repo-a')).toBeUndefined();
  });
  it('should refuse unknown repositories, refs outside namespace and subpaths before forge work', async () => {
    const registry = createGitRepositoryRegistry([{ ...repository, canWrite: true }]);
    for (const branch of ['main', 'refs/heads/artifact/demo', 'artifact/../main', 'artifact/a.lock', 'artifact//x']) {
      await expect(validateGitBindingTarget(registry, 'scope-a', 'repo-a', branch, ''))
        .rejects.toMatchObject({ kind: 'git_ref_not_allowed' });
    }
    await expect(validateGitBindingTarget(registry, 'scope-b', 'repo-a', 'artifact/demo', ''))
      .rejects.toMatchObject({ kind: 'git_repo_not_registered' });
    await expect(validateGitBindingTarget(registry, 'scope-a', 'repo-a', 'artifact/demo', '../'))
      .rejects.toMatchObject({ kind: 'git_ref_not_allowed' });
    expect(await validateGitBindingTarget(registry, 'scope-a', 'repo-a', 'artifact/demo', '')).toMatchObject(repository);
  });
});
