import type { ScopeGrant } from './authority.js';
import { MemoryBackend, createIndexedBackendScopeState } from './backend.js';
import type { StorageScope, WriterFence } from './contracts.js';
import { createKernel } from './kernel.js';
import { RootMutationCoordinator } from './mutation-coordinator.js';
import { RootScopedRuntime } from './root-facade.js';
import { StagedCore, type StagedCoreOptions } from './staged-core.js';
import { prepareStagedRootNotice } from './staged-effects.js';
import type { StagedControl } from './staged-state.js';

export type StagedKernelOptions = StagedCoreOptions;
export interface StagedKernelHandle {
  readonly moduleId: string; readonly incarnation: string;
  bind(grant: ScopeGrant<unknown>): RootScopedRuntime;
}
export interface StagedKernelRoot extends StagedKernelHandle {
  bindNew(grant: ScopeGrant<unknown>): RootScopedRuntime;
  revoke(token: string): void | Promise<void>;
  adapter(): StagedKernelHandle;
  provisionFence(scope: StorageScope, ownerId: string, fence: WriterFence, expiresAt?: string | null): void;
  rotateFence(scope: StorageScope, fence: WriterFence, ownerId?: string, expiresAt?: string | null): void;
  armFailure(scope: StorageScope, point: StagedControl['failures'] extends Set<infer T> ? T : never): void;
}
export const createRootStagedKernel = (options: StagedKernelOptions): StagedKernelRoot => {
  const backend = options.backend ?? new MemoryBackend(createIndexedBackendScopeState);
  let core: StagedCore;
  const coordinator = new RootMutationCoordinator(backend, {
    prepare: (...args) => prepareStagedRootNotice(core, ...args),
    accessible: (root, _kind, key) => core.accessible(root, key),
    fence: (grant, fence) => core.assertFence(grant, fence),
  });
  const inner = createKernel({ ...options, backend, coordinator });
  core = new StagedCore(inner, backend, coordinator, options);
  const bind = (grant: ScopeGrant<unknown>) => new RootScopedRuntime(core, inner.bind(grant));
  const adapter: StagedKernelHandle = Object.freeze({ moduleId: inner.moduleId, incarnation: inner.incarnation, bind });
  return Object.freeze({
    ...adapter,
    bindNew: (grant: ScopeGrant<unknown>) => new RootScopedRuntime(core, inner.bindNew(grant)),
    revoke: (token: string) => inner.revoke(token), adapter: () => adapter,
    provisionFence: (scope: StorageScope, ownerId: string, fence: WriterFence, expiresAt?: string | null) => core.provisionFence(scope, ownerId, fence, expiresAt),
    rotateFence: (scope: StorageScope, fence: WriterFence, ownerId?: string, expiresAt?: string | null) => core.rotateFence(scope, fence, ownerId, expiresAt),
    armFailure: (scope: StorageScope, point: StagedControl['failures'] extends Set<infer T> ? T : never) => { core.control(scope).failures.add(point); },
  });
};
