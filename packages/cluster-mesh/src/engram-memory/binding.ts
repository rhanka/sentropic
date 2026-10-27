// engram-memory public host assembly (lot E7). The host composition owns
// the PG driver/pool lifecycle and a distinct host-issued maintain grant;
// Engram receives the neutral binding only (exactly ['read','write']).
// Assembly validates both authorities up front with typed refusals and
// returns a frozen binding. Neither the maintain grant nor any maintenance
// port escapes through the neutral memory handle. Storage opening stays
// refused until G1b wires the backend-backed resolver; this seam carries
// authority only.

import { randomUUID } from 'node:crypto';
import { validateScopeGrant, type ScopeGrant } from '../storage/authority.js';
import { StorageDeniedError } from '../storage/errors.js';
import { validateStorageScope, type StorageScope } from '../storage/contracts.js';
import { checkMemoryPostgresDriver, type MemoryPostgresDriverProvider } from './postgres.js';
import type { HostRecoveryProof, MemoryAuthorityLedger } from './ledger.js';

/** The only operations Engram's neutral memory handle ever carries. */
export const MEMORY_HANDLE_OPERATIONS = ['read', 'write'] as const;

/**
 * Liveness of a maintain grant: it must carry the maintain operation and,
 * for lease lifetimes, must not be expired. Revocation is checked against
 * the live grants table by the G1b backend at use time; until then the
 * fail-closed ports refuse everything anyway.
 */
export const assertMaintainGrantLive = (grant: unknown, nowIso: string = new Date().toISOString()): void => {
  const candidate = grant as Partial<ScopeGrant<unknown>> | null | undefined;
  if (typeof candidate !== 'object' || candidate === null || !Array.isArray(candidate.operations)) {
    throw new StorageDeniedError('host binding requires a grant carrying the maintain operation');
  }
  if (!(candidate.operations as readonly unknown[]).includes('maintain')) {
    throw new StorageDeniedError('host binding requires a grant carrying the maintain operation');
  }
  const lifetime = candidate.lifetime;
  if (typeof lifetime === 'object' && lifetime !== null && lifetime.kind === 'lease') {
    // Kernel lease semantics (contracts.ts): numeric Date.parse comparison,
    // never lexicographic — offsets and precisions compare correctly.
    const expiry = typeof lifetime.expiresAt === 'string' ? Date.parse(lifetime.expiresAt) : NaN;
    if (!Number.isFinite(expiry) || expiry <= Date.parse(nowIso)) {
      throw new StorageDeniedError('host maintain grant lease has expired');
    }
  }
};

/**
 * Host-issued maintain grant: exactly `['maintain']`, never combined with
 * read/write. A combined grant is refused at runtime and rejected at
 * compile time (not assignable to this type).
 */
export type MemoryMaintainGrant = ScopeGrant<unknown> & {
  readonly operations: readonly ['maintain'];
};

/**
 * Neutral Engram-facing grant: exactly `['read','write']`, minted by the
 * host assembly. It carries no maintain authority by construction.
 */
export type MemoryNeutralGrant = ScopeGrant<unknown> & {
  readonly operations: readonly ['read', 'write'];
};

export interface MemoryHostBindingInput {
  readonly driver: unknown;
  readonly maintainGrant: unknown;
  readonly invocationId: string;
}

export interface MemoryHostBinding {
  readonly provider: MemoryPostgresDriverProvider;
  readonly maintainGrant: MemoryMaintainGrant;
  readonly memoryGrant: MemoryNeutralGrant;
  readonly memoryOperations: typeof MEMORY_HANDLE_OPERATIONS;
}

const isExactMaintain = (grant: ScopeGrant<unknown>): grant is MemoryMaintainGrant =>
  Array.isArray(grant.operations) && grant.operations.length === 1 && grant.operations[0] === 'maintain';

/**
 * Assemble the host binding: checked PG provider, a host-issued grant with
 * exactly the maintain operation (a combined read/write/maintain grant is
 * refused — it would leak maintain authority into the write path), and the
 * derived neutral grant (exactly read/write) for the same scope. The two
 * grants are separate objects; Engram receives only the neutral one.
 */
export const assembleMemoryHostBinding = (input: MemoryHostBindingInput): MemoryHostBinding => {
  const provider = checkMemoryPostgresDriver(input?.driver);
  const valid = validateScopeGrant(input?.maintainGrant, { expectedModuleId: 'engram-memory' });
  if (!valid.ok) throw new StorageDeniedError('host binding requires a valid maintain grant');
  const grant = input.maintainGrant as ScopeGrant<unknown>;
  assertMaintainGrantLive(grant);
  if (!isExactMaintain(grant)) {
    throw new StorageDeniedError('host maintain grant must carry exactly the maintain operation');
  }
  if (typeof input?.invocationId !== 'string' || input.invocationId.length === 0) {
    throw new StorageDeniedError('host binding requires a host invocation identity');
  }
  const neutral: MemoryNeutralGrant = Object.freeze({
    token: `memory-neutral-${grant.scope.tenantId}-${grant.scope.workspaceId}-${input.invocationId}`,
    moduleId: grant.moduleId,
    scope: grant.scope,
    principalId: grant.principalId,
    operations: MEMORY_HANDLE_OPERATIONS,
    issuer: grant.issuer,
    authorityRevision: grant.authorityRevision,
    policyRevision: grant.policyRevision,
    moduleAuthority: null,
    lifetime: Object.freeze({ kind: 'invocation', invocationId: input.invocationId }),
  });
  return Object.freeze({
    provider,
    maintainGrant: grant,
    memoryGrant: neutral,
    memoryOperations: MEMORY_HANDLE_OPERATIONS,
  });
};

/**
 * Verify the binding against the kernel's authoritative grants table by
 * binding the maintain grant: a revoked or never-issued grant is refused
 * by the store itself, not by a local copy. An optional expected scope
 * pins the binding to one scope — a foreign scope is refused even with a
 * live grant. The binder is the kernel's `bind` (check-only, no issue).
 */
export const verifyHostBinding = async (
  binder: { bind(grant: ScopeGrant<unknown>): Promise<unknown> },
  binding: MemoryHostBinding,
  scope?: StorageScope,
): Promise<void> => {
  if (typeof binding !== 'object' || binding === null) {
    throw new StorageDeniedError('host binding verification requires an assembled binding');
  }
  assertMaintainGrantLive(binding.maintainGrant);
  if (scope !== undefined) {
    if (
      scope.tenantId !== binding.maintainGrant.scope.tenantId ||
      scope.workspaceId !== binding.maintainGrant.scope.workspaceId
    ) {
      throw new StorageDeniedError('host binding scope does not match the maintain grant scope');
    }
  }
  await binder.bind(binding.maintainGrant);
};

/** Fresh host authentication for a later invocation (E8 answer 2). */
export interface MemoryContinuationAttestation {
  readonly invocationId: string;
  readonly issuedAt: string;
  readonly hostPrincipal: string;
}

export interface MemoryContinuation {
  readonly grant: ScopeGrant<unknown>;
  readonly candidateId: string;
  readonly storeId: string;
}

/**
 * Issue the explicit host-controlled continuation grant for a retained
 * candidate. The ledger must already hold the candidate (refusing on an
 * empty or unknown ledger is correct until rehydration); the grant scope
 * always comes from the retained record, so a foreign scope can never be
 * minted; the attestation must carry a fresh invocation identity with host
 * authn. Copied fields never grant: reusing the retained or an
 * already-recorded invocation is refused by the ledger. The grant carries
 * only the neutral operations with the new invocation lifetime, bound to
 * the retained candidate and scope.
 */
export const issueContinuationGrant = async (
  ledger: MemoryAuthorityLedger,
  binding: MemoryHostBinding,
  candidateId: string,
  attestation: MemoryContinuationAttestation,
): Promise<MemoryContinuation> => {
  const retained = await ledger.read(candidateId);
  if (!retained) throw new StorageDeniedError('no retained authority for this candidate');
  if (retained.state === 'terminal') {
    throw new StorageDeniedError('completed candidates cannot continue');
  }
  if (
    typeof attestation !== 'object' ||
    attestation === null ||
    typeof attestation.invocationId !== 'string' ||
    attestation.invocationId.length === 0 ||
    typeof attestation.issuedAt !== 'string' ||
    attestation.issuedAt.length === 0 ||
    typeof attestation.hostPrincipal !== 'string' ||
    attestation.hostPrincipal.length === 0
  ) {
    throw new StorageDeniedError('continuation requires fresh host authentication');
  }
  if (attestation.hostPrincipal !== retained.hostPrincipal) {
    throw new StorageDeniedError('continuation requires the original host principal');
  }
  if (binding.maintainGrant.principalId !== retained.hostPrincipal) {
    throw new StorageDeniedError('continuation binding serves a different host principal');
  }
  const updated = await ledger.recordContinuation(candidateId, attestation.invocationId);
  const grant: MemoryNeutralGrant = Object.freeze({
    token: `memory-continuation-${randomUUID()}`,
    moduleId: 'engram-memory',
    scope: updated.scope,
    principalId: attestation.hostPrincipal,
    operations: MEMORY_HANDLE_OPERATIONS,
    issuer: binding.maintainGrant.issuer,
    authorityRevision: binding.maintainGrant.authorityRevision,
    policyRevision: binding.maintainGrant.policyRevision,
    moduleAuthority: null,
    lifetime: Object.freeze({ kind: 'invocation', invocationId: attestation.invocationId }),
  });
  return {
    candidateId: updated.candidateId,
    storeId: updated.storeId,
    grant,
  };
};

/** Spent or never-tracked candidate: the host ledger holds no entry. */
export class MemoryMaintenanceNotFoundError extends Error {
  readonly code = 'NOT_FOUND' as const;
  constructor(candidateId: string) {
    super(`NOT_FOUND: no host ledger entry for memory candidate '${candidateId}'`);
    this.name = 'MemoryMaintenanceNotFoundError';
  }
}

const checkBindingScope = (binding: MemoryHostBinding, scope: StorageScope, what: string): void => {
  if (
    scope.tenantId !== binding.maintainGrant.scope.tenantId ||
    scope.workspaceId !== binding.maintainGrant.scope.workspaceId
  ) {
    throw new StorageDeniedError(`${what} scope does not match the maintain grant scope`);
  }
};

/**
 * Reattach a host maintenance session to a retained candidate. An unknown
 * candidate — never tracked, or drained after its invocation was spent —
 * surfaces NOT_FOUND (never a refusal and never a fresh reservation). A
 * foreign scope is refused; an expired maintain grant cannot reattach.
 */
export const reattachMemoryMaintenance = async (
  binding: MemoryHostBinding,
  ledger: MemoryAuthorityLedger,
  candidateId: string,
): Promise<MemoryMaintainGrant> => {
  if (typeof binding !== 'object' || binding === null) {
    throw new StorageDeniedError('memory reattach requires an assembled binding');
  }
  const retained = await ledger.read(candidateId);
  if (!retained) throw new MemoryMaintenanceNotFoundError(candidateId);
  checkBindingScope(binding, retained.scope, 'reattach');
  assertMaintainGrantLive(binding.maintainGrant);
  return binding.maintainGrant;
};

/**
 * Proof-only recovery through the host binding (E8 answer 4): the caller
 * must hold a live maintain grant for the retained scope — a foreign
 * scope is refused even with a live grant. Unknown or drained candidates
 * are refused; use reattach to distinguish the spent (NOT_FOUND) case.
 * By construction this path cannot write.
 */
export const proveForRecoveryAuthorized = async (
  ledger: MemoryAuthorityLedger,
  binding: MemoryHostBinding,
  candidateId: string,
  scope?: StorageScope,
): Promise<HostRecoveryProof> => {
  if (typeof binding !== 'object' || binding === null) {
    throw new StorageDeniedError('authorized recovery requires an assembled binding');
  }
  assertMaintainGrantLive(binding.maintainGrant);
  const retained = await ledger.read(candidateId);
  if (!retained) throw new StorageDeniedError('no retained evidence for this candidate');
  checkBindingScope(binding, retained.scope, 'recovery');
  if (scope !== undefined) {
    if (!validateStorageScope(scope).ok) throw new StorageDeniedError('recovery scope must be valid');
    if (scope.tenantId !== retained.scope.tenantId || scope.workspaceId !== retained.scope.workspaceId) {
      throw new StorageDeniedError('recovery scope does not match the retained evidence');
    }
  }
  return Object.freeze({
    candidateId: retained.candidateId,
    storeId: retained.storeId,
    scope: retained.scope,
    envelopeDigest: retained.envelopeDigest,
    state: retained.state,
    receipt: retained.receipt,
    cursor: retained.cursor,
  });
};
