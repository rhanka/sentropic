import type { ScopeGrant } from './authority.js';
import { MemoryBackend, createIndexedBackendScopeState } from './backend.js';
import type { StorageScope, WriterFence } from './contracts.js';
import { createKernel } from './kernel.js';
import { RootMutationCoordinator } from './mutation-coordinator.js';
import { RootScopedRuntime } from './root-facade.js';
import { StagedCore, type StagedCoreOptions } from './staged-core.js';
import { prepareStagedRootNotice } from './staged-effects.js';
import { StorageInvalidCommandError, UnsupportedProfileError } from './errors.js';
import { recoverStagedOperation, readRecoveryEvidence, type OperationRecovery, type RecoveryEvidence } from './staged-recovery.js';

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
  recoverOperation(operator: ScopeGrant<unknown>, request: OperationRecovery): ReturnType<typeof recoverStagedOperation>;
  recoveryEvidence(operator: ScopeGrant<unknown>, operationKey: string, after?: number, limit?: number): readonly RecoveryEvidence[];
}
export const createRootStagedKernel = (options: StagedKernelOptions): StagedKernelRoot => {
  // The qualified codec retains SHA-256 commitments for comments. Private
  // live storage requires its disposable/keyed policy before using K4.
  if (options.moduleId !== 'comments') throw new UnsupportedProfileError('staged-units-v1:payload-commitment-policy');
  if (options.descriptor?.queryNames.some((name) => !options.queries || !Object.hasOwn(options.queries, name))) throw new StorageInvalidCommandError('descriptor query has no registered implementation');
  const backend = options.backend ?? new MemoryBackend(createIndexedBackendScopeState);
  const coordinator = new RootMutationCoordinator(backend, {
    prepare: (...args) => prepareStagedRootNotice(core, ...args),
    accessible: (root, _kind, key) => core.accessible(root, key),
    fence: (grant, fence) => core.assertFence(grant, fence),
  }, options.limits);
  const inner = createKernel({ ...options, backend, coordinator });
  const core: StagedCore = new StagedCore(inner, backend, coordinator, options);
  const bind = (grant: ScopeGrant<unknown>) => new RootScopedRuntime(core, inner.bind(grant));
  const adapter: StagedKernelHandle = Object.freeze({ moduleId: inner.moduleId, incarnation: inner.incarnation, bind });
  return Object.freeze({
    ...adapter,
    bindNew: (grant: ScopeGrant<unknown>) => new RootScopedRuntime(core, inner.bindNew(grant)),
    revoke: (token: string) => inner.revoke(token), adapter: () => adapter,
    provisionFence: (scope: StorageScope, ownerId: string, fence: WriterFence, expiresAt?: string | null) => core.provisionFence(scope, ownerId, fence, expiresAt),
    rotateFence: (scope: StorageScope, fence: WriterFence, ownerId?: string, expiresAt?: string | null) => core.rotateFence(scope, fence, ownerId, expiresAt),
    recoverOperation: (operator: ScopeGrant<unknown>, request: OperationRecovery) => recoverStagedOperation(core, operator, request),
    recoveryEvidence: (operator: ScopeGrant<unknown>, key: string, after?: number, limit?: number) => readRecoveryEvidence(core, operator, key, after, limit),
  });
};
