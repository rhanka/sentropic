import { describe, expect, it } from 'vitest';
import {
  admitBinding, bindingOf, BUILDER_REPOSITORIES_ENV, createForgeBindings, forgeConfig,
} from '../../../src/services/artifacts/live/forge-binding';
import { key, memoryRows } from './fixture';
import { binding, leaseHost, reposEnv, repository } from './forge-fixture';

const refused = (run: () => unknown, code: string) => {
  let error: unknown; try { run(); } catch (caught) { error = caught; }
  expect(error).toMatchObject({ code });
};

describe('forge binding mapping (contract §1)', () => {
  it('should parse only the closed {repoId, branch, subPath} shape', () => {
    expect(bindingOf(binding)).toEqual(binding);
    for (const value of [undefined, null, [], {}, { ...binding, extra: 1 }, { repoId: 'repo-immo', branch: 'artifact/demo' },
      { ...binding, repoId: '' }, { ...binding, branch: 1 }, { ...binding, subPath: null }]) expect(bindingOf(value)).toBeNull();
  });

  it('should refuse in the contract order: target, builder repository, branch, subPath', () => {
    const config = forgeConfig(reposEnv(), leaseHost());
    expect(admitBinding(config, key.storageScopeId, binding)).toMatchObject({ locator: 'rhanka/radar-immobilier' });
    refused(() => admitBinding(config, key.storageScopeId, { ...binding, repoId: 'repo-unknown' }), 'git_repo_not_registered');
    refused(() => admitBinding(config, 'scope-other', binding), 'git_repo_not_registered');
    // A GitHub App target that is not a builder repository.
    refused(() => admitBinding(config, key.storageScopeId, { ...binding, repoId: 'repo-sentropic' }), 'git_repo_not_registered');
    for (const branch of ['main', 'refs/heads/artifact/demo', 'artifact/../x', 'artifact/.hidden', 'artifact/x.lock']) {
      refused(() => admitBinding(config, key.storageScopeId, { ...binding, branch }), 'git_ref_not_allowed');
    }
    refused(() => admitBinding(config, key.storageScopeId, { ...binding, subPath: 'ui' }), 'git_ref_not_allowed');
    const nested = forgeConfig(reposEnv([{ ...repository, allowedSubPaths: ['apps/web'] }]), leaseHost());
    expect(admitBinding(nested, key.storageScopeId, { ...binding, subPath: 'apps/web' })).toBeTruthy();
    for (const subPath of ['', 'apps/./web', 'apps/../web', 'apps\\web', 'apps/web/']) {
      refused(() => admitBinding(nested, key.storageScopeId, { ...binding, subPath }), 'git_ref_not_allowed');
    }
  });

  it('should keep a binding immutable per generation: another value is 409 binding_conflict, a new generation records', async () => {
    const bindings = createForgeBindings(memoryRows(), forgeConfig(reposEnv(), leaseHost()));
    await bindings.admit(key, 1, binding);
    await bindings.admit(key, 1, { ...binding });
    await expect(bindings.admit(key, 1, { ...binding, branch: 'artifact/other' })).rejects.toMatchObject({ code: 'binding_conflict' });
    await expect(bindings.read(key, 1)).resolves.toEqual(binding);
    await bindings.admit(key, 2, { ...binding, branch: 'artifact/other' });
    await expect(bindings.read(key, 2)).resolves.toEqual({ ...binding, branch: 'artifact/other' });
    await expect(bindings.admit(key, 3, { ...binding, branch: 'main' })).rejects.toMatchObject({ code: 'git_ref_not_allowed' });
    await expect(bindings.read(key, 3)).resolves.toBeUndefined();
  });
});

describe('forge configuration (contract §2, fail-closed)', () => {
  it('should refuse forge_unconfigured when the configuration is absent, invalid, inconsistent or the App host is disabled', async () => {
    const host = leaseHost();
    expect(forgeConfig(reposEnv(), host)?.repositories).toEqual([repository]);
    const invalid = [{}, { [BUILDER_REPOSITORIES_ENV]: '' }, { [BUILDER_REPOSITORIES_ENV]: 'not json' }, reposEnv([]), reposEnv({}),
      reposEnv([{ ...repository, installationRef: undefined }]), reposEnv([{ ...repository, installationRef: 'unknown' }]),
      reposEnv([{ ...repository, extra: 1 }]), reposEnv([{ ...repository, locator: 'rhanka/other' }]),
      reposEnv([{ ...repository, locator: 'rhanka/sentropic' }]), reposEnv([{ ...repository, repoId: 'repo-unknown' }]),
      reposEnv([{ ...repository, allowedSubPaths: [] }]), reposEnv([{ ...repository, allowedSubPaths: ['../x'] }]),
      reposEnv([repository, repository])];
    for (const env of invalid) expect(forgeConfig(env, host)).toBeNull();
    expect(forgeConfig(reposEnv(), null)).toBeNull();
    refused(() => admitBinding(null, key.storageScopeId, binding), 'builder_unavailable');
    const bindings = createForgeBindings(memoryRows(), null);
    await expect(bindings.admit(key, 1, binding)).rejects.toMatchObject({ code: 'builder_unavailable', reason: 'forge_unconfigured' });
    await expect(bindings.read(key, 1)).resolves.toBeUndefined();
  });
});
