import { MemoryBackend, createIndexedBackendScopeState } from '../../src/storage/backend.js';
import { createKernel } from '../../src/storage/kernel.js';
import { RootMutationCoordinator } from '../../src/storage/mutation-coordinator.js';
import { StagedCore, type StagedCoreOptions } from '../../src/storage/staged-core.js';
import { prepareStagedRootNotice } from '../../src/storage/staged-effects.js';
import { grantFor } from './authority-corpus.js';

export const FENCE = { fenceId: 'root-test-lane', epoch: '1' };
export const stagedRootFixture = (options: Partial<StagedCoreOptions> = {}) => {
  const backend = options.backend ?? new MemoryBackend(createIndexedBackendScopeState);
  let core: StagedCore;
  const coordinator = new RootMutationCoordinator(backend, {
    prepare: (...args) => prepareStagedRootNotice(core, ...args),
    accessible: (root, _kind, key) => core.accessible(root, key),
    fence: (grant, fence) => core.assertFence(grant, fence),
  });
  const config = { moduleId: 'comments', ...options, backend, coordinator };
  const kernel = createKernel(config);
  core = new StagedCore(kernel, backend, coordinator, config);
  const bound = kernel.bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
  core.provisionFence(bound.scope, bound.grant.principalId, FENCE);
  return { core, kernel, bound, backend, coordinator };
};
