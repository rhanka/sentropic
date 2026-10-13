// K3 neutral kernel factory (L3a v4.1 frozen §4, §5, §8, §17.1 K3).
// G3: readChainPage (via ScopedRuntime.readPage) uses the retained
// exact-head boundary provider: server-side registry, exact head,
// immutable boundary, byte-identical cursors. No pg, no drizzle, no
// engram imports. Public types documented for the engram adapter.

import { StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import { validateScopeGrant, type ScopeGrant } from './authority.js';
import { MemoryBackend } from './backend.js';
import { ScopedRuntime, type ScopedRuntimeDeps } from './scope-runtime.js';
import { RetainedExactHeadBoundaryProvider, createOpaqueIssuer } from './tokens.js';

export interface KernelOptions {
  /** Owning module id (for example 'comments'). */
  readonly moduleId: string;
  /** Stable store incarnation bound into every cursor. Defaults to 'store-1'. */
  readonly incarnation?: string;
  /** Clock for grant lifetimes and receipts. Defaults to live time. */
  readonly now?: () => string;
}

export interface KernelHandle {
  readonly moduleId: string;
  readonly incarnation: string;
  bindNew(grant: ScopeGrant<unknown>): ScopedRuntime;
  bind(grant: ScopeGrant<unknown>): ScopedRuntime;
  revoke(token: string): void | Promise<void>;
}

export const createKernel = (options: KernelOptions): KernelHandle => {
  if (typeof options.moduleId !== 'string' || options.moduleId.length === 0) {
    throw new StorageInvalidCommandError('kernel requires a moduleId');
  }
  const moduleId = options.moduleId;
  const clock = options.now ?? (() => new Date().toISOString());
  const incarnation = options.incarnation ?? 'store-1';
  const backend = new MemoryBackend();
  const provider = new RetainedExactHeadBoundaryProvider();
  const revoked = new Set<string>();
  const issued = new Map<string, string>();
  const nextCommitId = createOpaqueIssuer('commit');
  const deps: ScopedRuntimeDeps = { moduleId, backend, provider, incarnation, clock, revoked, issued, nextCommitId };

  const admit = (grant: ScopeGrant<unknown>): void => {
    const validity = validateScopeGrant(grant, { nowIso: clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (grant.moduleId !== moduleId) throw new StorageDeniedError('wrong module');
    if (revoked.has(grant.token)) throw new StorageDeniedError('grant revoked');
  };

  return {
    moduleId,
    incarnation,
    revoke: (token: string): void => {
      revoked.add(token);
    },
    bindNew: (grant: ScopeGrant<unknown>): ScopedRuntime => {
      admit(grant);
      issued.set(grant.token, JSON.stringify(grant));
      return new ScopedRuntime(grant, moduleId, deps);
    },
    bind: (grant: ScopeGrant<unknown>): ScopedRuntime => {
      admit(grant);
      const recorded = issued.get(grant.token);
      if (!recorded) throw new StorageDeniedError('unknown grant token');
      if (recorded !== JSON.stringify(grant)) throw new StorageDeniedError('grant tampered');
      return new ScopedRuntime(grant, moduleId, deps);
    },
  };
};
