import { createRootStagedKernel, type StagedKernelOptions, type StagedKernelRoot } from '../../src/storage/staged-factory.js';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import type { AuthenticatedStagedHandle } from '../../src/storage/staged-state.js';
import type { StagedCommitRoot } from '../../src/storage/staged-units.js';
import { MemoryBackend, backendScopeKey, createIndexedBackendScopeState } from '../../src/storage/backend.js';
import type { StorageScope } from '../../src/storage/contracts.js';
import { StorageInvalidCommandError } from '../../src/storage/errors.js';

type FailurePoint = 'external' | 'purge-before' | 'purge-response' | 'stage-response' | 'commit-response';
type TestRoot = StagedKernelRoot & { armFailure(scope: StorageScope, point: FailurePoint): void };
const consume = (failures: Set<FailurePoint>, point: FailurePoint): void => {
  if (failures.delete(point)) throw new StorageInvalidCommandError(`test ${point} interruption`);
};

// The corpus drives bounded backend calls as a client. Trusted fixture
// controls never appear on production adapter handles.
const client = (root: TestRoot, bound: RootScopedRuntime, failures: Set<FailurePoint>) => {
  const fences = new Map<string, WriterFence>();
  const extra = {
    stageFragment: async (input: Parameters<RootScopedRuntime['stageFragment']>[0]) => {
      const result = await bound.stageFragment(input); consume(failures, 'stage-response'); return result;
    },
    commitStaged: async (input: Parameters<RootScopedRuntime['commitStaged']>[0]) => {
      const result = await bound.commitStaged(input); consume(failures, 'commit-response'); return result;
    },
    completePurge: async (id: string) => {
      const result = await bound.completePurge(id); consume(failures, 'purge-response'); return result;
    },
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
  const backend = options.backend ?? new MemoryBackend(createIndexedBackendScopeState);
  const points = new Map<string, Set<FailurePoint>>();
  const failures = (scope: StorageScope) => {
    const key = backendScopeKey(scope);
    if (!points.has(key)) points.set(key, new Set());
    return points.get(key)!;
  };
  const publish = backend.scopes.set.bind(backend.scopes);
  backend.scopes.set = (key, value) => {
    const armed = points.get(key);
    if (armed) { consume(armed, 'external'); consume(armed, 'purge-before'); }
    return publish(key, value);
  };
  const inner = createRootStagedKernel({ ...options, backend });
  const root: TestRoot = { ...inner, armFailure: (scope, point) => { failures(scope).add(point); } };
  return { ...root, bindNew: (grant: Parameters<StagedKernelRoot['bindNew']>[0]) => client(root, root.bindNew(grant), failures(grant.scope)),
    bind: (grant: Parameters<StagedKernelRoot['bind']>[0]) => client(root, root.bind(grant), failures(grant.scope)),
  };
};
