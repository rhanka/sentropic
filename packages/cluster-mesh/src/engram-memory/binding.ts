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

/** The only operations Engram's neutral memory handle ever carries. */
export const MEMORY_HANDLE_OPERATIONS = ['read', 'write'] as const;

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
  if (!grant.operations.includes('maintain')) {
    throw new StorageDeniedError('host binding requires a grant carrying the maintain operation');
  }
  return Object.freeze({
    provider,
    maintainGrant: grant,
    memoryOperations: MEMORY_HANDLE_OPERATIONS,
  });
};
