import { isStorageError, StorageCasConflictError, StorageIdempotencyConflictError, StorageInvalidCommandError, StorageUnavailableError } from '../errors.js';
import { CanonicalOwnershipError } from '../instance-ownership.js';

export type PgFailureCondition = 'contention' | 'timeout' | 'unavailable' | 'outcome_unknown' | 'corruption' | 'configuration' | 'schema-drift';
export class PostgresStorageError extends StorageUnavailableError {
  constructor(readonly condition: PgFailureCondition, readonly retryable = false, readonly sqlState?: string) {
    super(`Postgres storage ${condition}`);
    this.name = 'PostgresStorageError';
  }
}
export class PgSchemaDriftError extends PostgresStorageError {
  constructor(readonly expectedFingerprint: string, readonly actualFingerprint: string) {
    super('schema-drift');
    this.name = 'PgSchemaDriftError';
  }
}
export type PgConstraintMap = Readonly<Record<string, 'cas-conflict' | 'idempotency-conflict' | 'invalid-command'>>;
export const classifyPgFailure = (error: unknown, constraints: PgConstraintMap = {}): Error => {
  if (isStorageError(error)) return error;
  // Canonical ownership refusals surface unwrapped (registry/SQLite parity).
  if (error instanceof CanonicalOwnershipError) return error;
  const fields = typeof error === 'object' && error !== null ? error as Record<string, unknown> : {};
  // The deferred lease trigger (008 `instance_ownership_lease`) refuses a
  // lease that lapsed between the last renewal and COMMIT with P0001. The
  // outcome is a known rollback of a dead retained session, so it surfaces
  // the canonical code — never `unavailable`. The message is the trigger's
  // own (no writer bypassing the JS guard can raise it from another path).
  if (
    (fields.sqlState ?? fields.code) === 'P0001' &&
    typeof fields.message === 'string' &&
    fields.message.includes('instance lease not live')
  )
    return new CanonicalOwnershipError('terminal-loss', 'retained session expired before COMMIT');
  const candidate = fields.sqlState ?? fields.code;
  const state = typeof candidate === 'string' && /^[0-9A-Z]{5}$/.test(candidate) ? candidate : undefined;
  if (fields.outcome === 'unknown') return new PostgresStorageError('outcome_unknown', false, state);
  if (state === '40001' || state === '40P01') return new PostgresStorageError('contention', true, state);
  if (fields.phase === 'commit' && fields.outcome !== 'rolled-back') return new PostgresStorageError('outcome_unknown', false, state);
  if (state === '55P03' || state === '57014') return new PostgresStorageError('timeout', false, state);
  if (state?.startsWith('23')) {
    const constraint = typeof fields.constraint === 'string' ? fields.constraint : '';
    const mapping = Object.hasOwn(constraints, constraint) ? constraints[constraint] : undefined;
    if (mapping === 'cas-conflict') return new StorageCasConflictError('Postgres named CAS constraint');
    if (mapping === 'idempotency-conflict') return new StorageIdempotencyConflictError('Postgres named identity constraint');
    if (mapping === 'invalid-command') return new StorageInvalidCommandError('Postgres named domain constraint');
    return new PostgresStorageError('corruption', false, state);
  }
  return new PostgresStorageError('unavailable', false, state);
};
