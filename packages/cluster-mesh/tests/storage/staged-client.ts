import { createRootStagedKernel, type StagedKernelOptions, type StagedKernelRoot } from '../../src/storage/staged-factory.js';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import type { AuthenticatedStagedHandle } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';

// The corpus drives bounded backend calls as a client. Trusted fixture
// controls never appear on production adapter handles.
const client = (root: StagedKernelRoot, bound: RootScopedRuntime) => {
  const fences = new Map<string, WriterFence>();
  const extra = {
    beginStaged: async (input: Parameters<RootScopedRuntime['beginStaged']>[0]) => {
      root.provisionFence(bound.scope, bound.grant.principalId, input.fence);
      const handle = await bound.beginStaged(input);
      fences.set(handle.unitId, input.fence);
      return handle;
    },
    sealStaged: async (input: { readonly unit: AuthenticatedStagedHandle; readonly root: StagedCommitRoot }) => {
      const fence = fences.get(input.unit.unitId)!;
      let outcome;
      do { outcome = await bound.sealStep({ ...input, fence }); } while (outcome.state === 'validating');
      return outcome.seal;
    },
    abortStaged: async (input: { readonly unit: AuthenticatedStagedHandle; readonly fence?: WriterFence; readonly reason?: string }) =>
      bound.abortStaged({ ...input, fence: input.fence ?? fences.get(input.unit.unitId)!, reason: input.reason ?? 'test client cancellation' }),
    armExternalFailure: async () => root.armFailure(bound.scope, 'external'),
    armPurgeFailure: async () => root.armFailure(bound.scope, 'purge-before'),
    armPurgeResponseFailure: async () => root.armFailure(bound.scope, 'purge-response'),
  };
  return new Proxy(bound, { get(target, property) {
    if (Object.hasOwn(extra, property)) return extra[property as keyof typeof extra];
    const value: unknown = Reflect.get(target, property, target);
    return typeof value === 'function' ? value.bind(target) : value;
  } }) as RootScopedRuntime & typeof extra;
};
export const createStagedTestKernel = (options: StagedKernelOptions) => {
  const root = createRootStagedKernel(options);
  return { ...root, bindNew: (grant: Parameters<StagedKernelRoot['bindNew']>[0]) => client(root, root.bindNew(grant)),
    bind: (grant: Parameters<StagedKernelRoot['bind']>[0]) => client(root, root.bind(grant)),
  };
};
