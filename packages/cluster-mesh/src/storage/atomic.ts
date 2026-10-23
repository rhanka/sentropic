// K1 atomic units, CAS/allocation and replay rules (L3a v4.1 frozen §5).
// Types plus data-pure validators; no transaction machinery (K3).

import {
  errResult,
  isDecimalCounter,
  isHexDigest,
  isNonEmptyString,
  isPositiveSafeInteger,
  isSafeInteger,
  okResult,
  validateEncodedValue,
  validateWorkLimits,
  validateWriterFence,
  type DecimalCounter,
  type EncodedValue,
  type StorageScope,
  type ValidationResult,
  type WorkLimits,
  type WriterFence,
} from './contracts.js';

export type ChainExpectation =
  | { readonly kind: 'absent'; readonly allocation: DecimalCounter }
  | { readonly kind: 'head'; readonly hash: string };

export const validateChainExpectation = (expectation: unknown): ValidationResult => {
  if (typeof expectation !== 'object' || expectation === null) return errResult('expectation must be an object');
  const candidate = expectation as Record<string, unknown>;
  if (candidate['kind'] === 'absent') {
    if (!isDecimalCounter(candidate['allocation'])) return errResult('absent expectation requires a decimal allocation');
    return okResult();
  }
  if (candidate['kind'] === 'head') {
    if (!isNonEmptyString(candidate['hash'])) return errResult('head expectation requires a hash');
    return okResult();
  }
  return errResult('expectation kind must be absent or head');
};

export interface RecordWrite {
  readonly key: string;
  readonly bytes: EncodedValue;
  readonly contentHash: string;
}

export interface ChainAppend {
  readonly chainId: string;
  readonly record: { readonly id: string; readonly bytes: string; readonly hash: string };
  readonly expectation: ChainExpectation;
}

export interface AggregateUpdate {
  readonly key: string;
  readonly version: number;
  readonly value: EncodedValue;
}

export interface RelationshipChange {
  readonly kind: 'add' | 'remove';
  readonly relation: string;
  readonly from: string;
  readonly to: string;
}

export interface BarrierWrite {
  readonly boundary: string;
  readonly reason: string;
}

export interface AuthorizedPurgeIntent {
  readonly target: string;
  readonly intentId: string;
  readonly authorizedBy: string;
}

export interface IndexWrite {
  readonly key: string;
  readonly digest: string;
  readonly resultIds: readonly string[];
  readonly resultHash: string | null;
}

export type RegisteredGuard =
  | { readonly kind: 'head'; readonly chainId: string; readonly hash: string }
  | { readonly kind: 'absent'; readonly chainId: string }
  | { readonly kind: 'aggregate-version'; readonly key: string; readonly version: number }
  | { readonly kind: 'predicate'; readonly predicateId: string; readonly dependency: string };

export interface AtomicUnit {
  readonly guards: readonly RegisteredGuard[];
  readonly records: readonly RecordWrite[];
  readonly appends: readonly ChainAppend[];
  readonly updates: readonly AggregateUpdate[];
  readonly relationships: readonly RelationshipChange[];
  readonly barriers: readonly BarrierWrite[];
  readonly purgeIntents: readonly AuthorizedPurgeIntent[];
  readonly indexWrites: readonly IndexWrite[];
  readonly moduleResult?: EncodedValue;
}

export interface CommitOptions {
  readonly idempotencyKey?: string;
  readonly fence?: WriterFence;
  readonly limits?: WorkLimits;
}

export interface CommitReceipt {
  readonly commitId: string;
  readonly moduleId: string;
  readonly scope: StorageScope;
  readonly committedAt: string;
  readonly effectiveRecords: number;
  readonly effectiveAppends: number;
  readonly journalCursor: string;
  readonly moduleResult?: EncodedValue;
}

export interface IdempotencySelector {
  readonly key: string;
}

export interface IdempotencyEntry {
  readonly digest: string;
  readonly resultIds: readonly string[];
  readonly resultHash: string | null;
}

const validateAppend = (append: ChainAppend): string | null => {
  if (typeof append !== 'object' || append === null) return 'append must be an object';
  if (!isNonEmptyString(append.chainId)) return 'append requires a chainId';
  if (typeof append.record !== 'object' || append.record === null) return 'append requires a record';
  if (!isNonEmptyString(append.record.id)) return 'append record requires an id';
  if (typeof append.record.bytes !== 'string') return 'append record requires bytes';
  if (!isNonEmptyString(append.record.hash)) return 'append record requires a hash';
  const expectation = validateChainExpectation(append.expectation);
  if (!expectation.ok) return expectation.errors.join('; ');
  return null;
};

export const validateAtomicUnit = (unit: AtomicUnit, limits?: WorkLimits): ValidationResult => {
  if (typeof unit !== 'object' || unit === null || !['guards', 'records', 'appends', 'updates', 'relationships', 'barriers', 'purgeIntents', 'indexWrites']
    .every((key) => Array.isArray((unit as unknown as Record<string, unknown>)[key]))) return errResult('invalid atomic unit shape');
  const errors: string[] = [];
  const effectCount =
    unit.records.length +
    unit.appends.length +
    unit.updates.length +
    unit.relationships.length +
    unit.barriers.length +
    unit.purgeIntents.length +
    unit.indexWrites.length;
  if (effectCount === 0) errors.push('unit carries no effects');
  if (limits) {
    const validity = validateWorkLimits(limits);
    if (!validity.ok) return validity;
    if (unit.records.length > limits.maxRecords) errors.push('unit exceeds maxRecords');
    if (unit.appends.length > limits.maxAppends) errors.push('unit exceeds maxAppends');
  }
  for (const append of unit.appends) {
    const failure = validateAppend(append);
    if (failure) errors.push(failure);
  }
  for (const record of unit.records) {
    if (!isNonEmptyString(record?.key) || !isNonEmptyString(record?.contentHash) || !validateEncodedValue(record?.bytes).ok) errors.push('record requires a key, content hash and encoded bytes');
  }
  for (const guard of unit.guards) {
    if (typeof guard !== 'object' || guard === null) { errors.push('guard must be an object'); continue; }
    if (guard.kind === 'head') {
      if (!isNonEmptyString(guard.chainId) || (guard.hash !== null && !isNonEmptyString(guard.hash))) errors.push('invalid head guard');
    } else if (guard.kind === 'absent') {
      if (!isNonEmptyString(guard.chainId)) errors.push('invalid absent guard');
    } else if (guard.kind === 'aggregate-version') {
      if (!isNonEmptyString(guard.key) || !isSafeInteger(guard.version) || guard.version < 0) errors.push('invalid aggregate guard');
    } else if (guard.kind === 'predicate') {
      if (!isNonEmptyString(guard.predicateId) || !isNonEmptyString(guard.dependency)) errors.push('invalid predicate guard');
    } else errors.push('unknown guard kind');
  }
  for (const change of unit.relationships) {
    if (!change || (change.kind !== 'add' && change.kind !== 'remove') || !isNonEmptyString(change.relation) || !isNonEmptyString(change.from) || !isNonEmptyString(change.to)) errors.push('invalid relationship');
  }
  for (const barrier of unit.barriers) {
    if (!isNonEmptyString(barrier?.boundary) || !isNonEmptyString(barrier?.reason)) errors.push('invalid barrier');
  }
  for (const intent of unit.purgeIntents) {
    if (!isNonEmptyString(intent?.target) || !isNonEmptyString(intent?.intentId) || !isNonEmptyString(intent?.authorizedBy)) errors.push('invalid purge intent');
  }
  for (const update of unit.updates) {
    if (!update) { errors.push('update must be an object'); continue; }
    if (!isNonEmptyString(update.key)) errors.push('update requires a key');
    if (!isSafeInteger(update.version) || update.version < 0) errors.push('update requires a version >= 0');
    const value = validateEncodedValue(update.value);
    if (!value.ok) errors.push(value.errors.join('; '));
  }
  for (const write of unit.indexWrites) {
    if (!write) { errors.push('index write must be an object'); continue; }
    if (!isNonEmptyString(write.key)) errors.push('index write requires a key');
    if (!isNonEmptyString(write.digest)) errors.push('index write requires a digest');
    if (!Array.isArray(write.resultIds) || !write.resultIds.every(isNonEmptyString) || (write.resultHash !== null && !isNonEmptyString(write.resultHash))) errors.push('invalid index result');
  }
  if (unit.moduleResult) {
    const result = validateEncodedValue(unit.moduleResult);
    if (!result.ok) errors.push(result.errors.join('; '));
  }
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export const validateCommitOptions = (options: CommitOptions): ValidationResult => {
  if (options.idempotencyKey !== undefined && !isNonEmptyString(options.idempotencyKey)) {
    return errResult('idempotencyKey must be non-empty when present');
  }
  if (options.fence !== undefined) {
    const fence = validateWriterFence(options.fence);
    if (!fence.ok) return fence;
  }
  if (options.limits !== undefined) return validateWorkLimits(options.limits);
  return okResult();
};

// Distinct replay rules (§5.4): identical canonical bytes are a no-op,
// conflicting bytes under the same identity conflict.
export const classifyImmutableReplay = (storedHash: string, incomingHash: string): 'noop' | 'conflict' =>
  storedHash === incomingHash ? 'noop' : 'conflict';

export const classifyGenesisReplay = (storedHash: string, incomingHash: string): 'replay' | 'conflict' =>
  storedHash === incomingHash ? 'replay' : 'conflict';

export const classifyIndexWrite = (
  storedDigest: string | null,
  incomingDigest: string,
): 'insert' | 'replace' | 'conflict' => {
  if (storedDigest === null) return 'insert';
  return storedDigest === incomingDigest ? 'replace' : 'conflict';
};

export const isRecordHash = (value: unknown): value is string => isNonEmptyString(value);

export const isDigestHex = (value: unknown): value is string => isHexDigest(value, 32);

export { isPositiveSafeInteger };
