import { describe, expect, it, vi } from 'vitest';
import { fixture, key, owner } from '../../cluster-mesh/tests/forge/fake-github.js';
import { createGitPort } from '../src/adapters/github-git-port.js';
import { commitInput, fakeGit, repo, target } from './fixtures/git-port-fake.js';

async function composition() {
  const forge = fakeGit();
  let port: ReturnType<typeof createGitPort>;
  const app = fixture({ onCredentialsChanged: async event => { port.invalidate(event); } });
  const entry = await app.ready();
  const scopedTarget = { ...target, storageScopeId: owner.storageScopeId, repoId: owner.repoId };
  const repository = { ...repo, ...scopedTarget, locator: owner.locator, installationRef: entry.installationRef };
  vi.mocked(forge.forge.repositoryId).mockResolvedValue('101');
  port = createGitPort({ ...forge.options, registry: { get: async () => repository }, leases: app.service,
    now: () => Date.parse('2026-11-05T12:00:00Z') });
  return { ...forge, app, entry, port, target: scopedTarget };
}

describe('cluster-mesh enrollment to GitPort invalidation', () => {
  it('should admit replacement leases after the documented App-key rotation callback', async () => {
    const f = await composition();
    await f.port.read(f.target, { commitSha: f.initial });
    await f.app.service.rotateAppKey(owner, f.entry.installationRef, key());
    await expect(f.port.read(f.target, { commitSha: f.initial })).resolves.toMatchObject({
      files: [{ path: 'ui/a.ts', text: 'first' }],
    });
    expect(f.forge.repositoryId).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('should fence an in-flight old lease when remote revocation fails (notification retry: %s)', async retry => {
    const f = await composition();
    f.app.failRevocation(true);
    const createTree = f.forge.createTree;
    f.forge.createTree = async (...args) => {
      const tree = await createTree(...args);
      if (retry) {
        f.app.failInvalidation(true);
        await expect(f.app.service.revoke(owner, f.entry.installationRef, 'owner_revoked'))
          .rejects.toThrow('capability_unavailable');
        f.app.failInvalidation(false);
      }
      await expect(f.app.service.revoke(owner, f.entry.installationRef, 'owner_revoked'))
        .rejects.toThrow('capability_unavailable');
      return tree;
    };
    await expect(f.port.commit({ ...commitInput(f.initial), target: f.target }))
      .rejects.toThrow('provider_unavailable');
    expect(f.forge.createCommit).not.toHaveBeenCalled();
    expect(f.refs.get(target.branch)).toBe(f.initial);
    expect(f.app.revoked).toHaveLength(0);
  });
});
