// engram-memory public host assembly (lot E7). The host composition owns
// the PG driver/pool lifecycle and a distinct host-issued maintain grant;
// Engram receives the neutral binding only (exactly ['read','write']).
// Assembly validates both authorities up front with typed refusals and
// returns a frozen binding. Neither the maintain grant nor any maintenance
// port escapes through the neutral memory handle. Storage opening stays
// refused until G1b wires the backend-backed resolver; this seam carries
// authority only.

import { validateScopeGrant, type ScopeGrant } from '../storage/authority.js';
import { StorageDeniedError } from '../storage/errors.js';
import { checkMemoryPostgresDriver, type MemoryPostgresDriverProvider } from './postgres.js';
import type { MemoryHostLedger } from './ledger.js';

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
    if (typeof lifetime.expiresAt !== 'string' || lifetime.expiresAt <= nowIso) {
      throw new StorageDeniedError('host maintain grant lease has expired');
    }
  }
};

export interface MemoryHostBindingInput {
  readonly driver: unknown;
  readonly maintainGrant: unknown;
}

export interface MemoryHostBinding {
  readonly provider: MemoryPostgresDriverProvider;
  readonly maintainGrant: ScopeGrant<unknown>;
  readonly memoryOperations: typeof MEMORY_HANDLE_OPERATIONS;
}

/**
 * Assemble the host binding: checked PG provider plus a host-issued grant
 * carrying the maintain operation for the engram-memory module scope.
 */
export const assembleMemoryHostBinding = (input: MemoryHostBindingInput): MemoryHostBinding => {
  const provider = checkMemoryPostgresDriver(input?.driver);
  const valid = validateScopeGrant(input?.maintainGrant, { expectedModuleId: 'engram-memory' });
  if (!valid.ok) throw new StorageDeniedError('host binding requires a valid maintain grant');
  const grant = input.maintainGrant as ScopeGrant<unknown>;
  assertMaintainGrantLive(grant);
  return Object.freeze({
    provider,
    maintainGrant: grant,
    memoryOperations: MEMORY_HANDLE_OPERATIONS,
  });
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
export const issueContinuationGrant = (
  ledger: MemoryHostLedger,
  candidateId: string,
  attestation: MemoryContinuationAttestation,
): MemoryContinuation => {
  const retained = ledger.read(candidateId);
  if (!retained) throw new StorageDeniedError('no retained authority for this candidate');
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
  const updated = ledger.recordContinuation(candidateId, attestation.invocationId);
  return {
    candidateId: updated.candidateId,
    storeId: updated.storeId,
    grant: Object.freeze({
      token: `memory-continuation-${candidateId}-${attestation.invocationId}`,
      moduleId: 'engram-memory',
      scope: updated.scope,
      principalId: attestation.hostPrincipal,
      operations: Object.freeze([...MEMORY_HANDLE_OPERATIONS]),
      issuer: 'host',
      authorityRevision: '1',
      policyRevision: '1',
      moduleAuthority: null,
      lifetime: Object.freeze({ kind: 'invocation', invocationId: attestation.invocationId }),
    }),
  };
};
