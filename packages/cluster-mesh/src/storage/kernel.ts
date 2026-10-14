// K3 neutral kernel factory (L3a v4.1 frozen §4, §5, §8, §17.1 K3).
// G3: readChainPage (via ScopedRuntime.readPage) uses the HMAC exact-head
// boundary provider: self-contained opaque cursors, exact head, immutable
// boundary. No pg, no drizzle, no engram imports. Public types documented
// for the engram adapter.
//
// Authority model (§4.1, §4.4): grant issuance belongs to the composition
// root through an injected ScopeAuthorityPort. The adapter-facing handle
// exposes binding only. Rights always derive from the server-side issuance
// record, never from the caller-supplied object: a divergent re-issuance
// under a known token is refused instead of overwriting it.

import { StorageDeniedError, StorageInvalidCommandError } from './errors.js';
import { validateScopeGrant, type ScopeGrant } from './authority.js';
import { MemoryBackend } from './backend.js';
import { ScopedRuntime, type ScopedRuntimeDeps } from './scope-runtime.js';
import { HmacExactHeadBoundaryProvider, createOpaqueIssuer, type ChainBoundaryProvider } from './tokens.js';
import type { PredicateEvaluator } from './record-runtime.js';

export interface ScopeAuthorityPort {
  attest(grant: ScopeGrant<unknown>): void;
}

export const createStaticAuthorityPort = (expectations: {
  readonly issuer?: string;
  readonly authorityRevision?: string;
  readonly policyRevision?: string;
} = {}): ScopeAuthorityPort => ({
  attest: (grant: ScopeGrant<unknown>): void => {
    if (expectations.issuer !== undefined && grant.issuer !== expectations.issuer) {
      throw new StorageDeniedError('unexpected grant issuer');
    }
    if (expectations.authorityRevision !== undefined && grant.authorityRevision !== expectations.authorityRevision) {
      throw new StorageDeniedError('unexpected authority revision');
    }
    if (expectations.policyRevision !== undefined && grant.policyRevision !== expectations.policyRevision) {
      throw new StorageDeniedError('unexpected policy revision');
    }
  },
});

export interface KernelOptions {
  /** Owning module id (for example 'comments'). */
  readonly moduleId: string;
  /** Stable store incarnation bound into every cursor. Defaults to 'store-1'. */
  readonly incarnation?: string;
  /** Clock for grant lifetimes and receipts. Defaults to live time. */
  readonly now?: () => string;
  /** Grant issuer. Defaults to a structural port with no revision pinning. */
  readonly authority?: ScopeAuthorityPort;
  /** Cursor seal secret. Kernels sharing it verify each other's cursors. */
  readonly cursorSecret?: string;
  /** Boundary provider override (tests, S1/P1 adapters). Defaults to HMAC. */
  readonly boundaryProvider?: ChainBoundaryProvider;
  /** Registered predicate evaluators by predicate id. */
  readonly predicates?: Readonly<Record<string, PredicateEvaluator>>;
}

/** Adapter-facing handle: binding only, no issuance, no revocation. */
export interface KernelHandle {
  readonly moduleId: string;
  readonly incarnation: string;
  bind(grant: ScopeGrant<unknown>): ScopedRuntime;
}

/** Composition-root handle: issuance, binding, revocation, adapter view. */
export interface KernelRoot extends KernelHandle {
  bindNew(grant: ScopeGrant<unknown>): ScopedRuntime;
  revoke(token: string): void | Promise<void>;
  adapter(): KernelHandle;
}

export const createKernel = (options: KernelOptions): KernelRoot => {
  if (typeof options.moduleId !== 'string' || options.moduleId.length === 0) {
    throw new StorageInvalidCommandError('kernel requires a moduleId');
  }
  const moduleId = options.moduleId;
  const clock = options.now ?? (() => new Date().toISOString());
  const incarnation = options.incarnation ?? 'store-1';
  const backend = new MemoryBackend();
  const provider = options.boundaryProvider ?? new HmacExactHeadBoundaryProvider(options.cursorSecret);
  const authority = options.authority ?? createStaticAuthorityPort();
  const revoked = new Set<string>();
  const issued = new Map<string, string>();
  const nextCommitId = createOpaqueIssuer('commit');
  const deps: ScopedRuntimeDeps = { moduleId, backend, provider, incarnation, clock, revoked, issued, nextCommitId, authority, predicates: options.predicates };

  const admit = (grant: ScopeGrant<unknown>): void => {
    const validity = validateScopeGrant(grant, { nowIso: clock() });
    if (!validity.ok) throw new StorageDeniedError(validity.errors.join('; '));
    if (grant.moduleId !== moduleId) throw new StorageDeniedError('wrong module');
    if (revoked.has(grant.token)) throw new StorageDeniedError('grant revoked');
    authority.attest(grant);
  };

  // Rights derive from the server-side issuance record: the handle is built
  // from the recorded copy, never from the caller-supplied object.
  const bindRecorded = (token: string): ScopedRuntime => {
    const recorded = issued.get(token);
    if (!recorded) throw new StorageDeniedError('unknown grant token');
    return new ScopedRuntime(JSON.parse(recorded) as ScopeGrant<unknown>, moduleId, deps);
  };

  const bind = (grant: ScopeGrant<unknown>): ScopedRuntime => {
    admit(grant);
    const recorded = issued.get(grant.token);
    if (!recorded) throw new StorageDeniedError('unknown grant token');
    if (recorded !== JSON.stringify(grant)) throw new StorageDeniedError('grant tampered');
    return bindRecorded(grant.token);
  };

  const bindNew = (grant: ScopeGrant<unknown>): ScopedRuntime => {
    admit(grant);
    const recorded = issued.get(grant.token);
    if (recorded !== undefined && recorded !== JSON.stringify(grant)) {
      throw new StorageDeniedError('divergent grant re-issuance');
    }
    if (recorded === undefined) issued.set(grant.token, JSON.stringify(grant));
    return bindRecorded(grant.token);
  };

  const root: KernelRoot = {
    moduleId,
    incarnation,
    revoke: (token: string): void => {
      revoked.add(token);
    },
    bindNew,
    bind,
    adapter: (): KernelHandle => ({ moduleId, incarnation, bind }),
  };
  return root;
};
