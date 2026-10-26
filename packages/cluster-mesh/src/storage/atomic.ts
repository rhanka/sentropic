// K1 atomic units, CAS/allocation and replay rules (L3a v4.1 frozen §5).
// Types plus data-pure validators; no transaction machinery (K3).
// E1 additive: exact-u64 comparison/allocation paths are opt-in; legacy
// safe-integer guards and versions keep their frozen behavior.

import {
  compareU64Counter,
  errResult,
  isDecimalCounter,
  isHexDigest,
  isNonEmptyString,
  isPositiveSafeInteger,
  isSafeInteger,
  isU64Counter,
  nextU64Counter,
  okResult,
  validateEncodedValue,
  validateWorkLimits,
  validateWriterFence,
  type ConsumedCounter,
  type ConsumedVersion,
  type DecimalCounter,
  type EncodedValue,
  type StorageScope,
  type U64Counter,
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

// E1 opt-in exact-u64 atomic paths: allocation comparison/increment and
// u64 chain expectations/versions. Legacy numeric guards above unchanged.
export type U64ChainExpectation =
  | { readonly kind: 'absent'; readonly allocation: U64Counter }
  | { readonly kind: 'head'; readonly hash: string };

export const isU64Allocation = (value: unknown): value is U64Counter => isU64Counter(value);

export const compareU64Allocation = (left: string, right: string): -1 | 0 | 1 => compareU64Counter(left, right);

export const nextU64Allocation = (value: string): U64Counter | undefined => nextU64Counter(value);

export const validateU64ChainExpectation = (expectation: unknown): ValidationResult => {
  if (typeof expectation !== 'object' || expectation === null) return errResult('expectation must be an object');
  const candidate = expectation as Record<string, unknown>;
  if (candidate['kind'] === 'absent') {
    if (!isU64Counter(candidate['allocation'])) return errResult('absent expectation requires a decimal allocation');
    return okResult();
  }
  if (candidate['kind'] === 'head') {
    if (!isNonEmptyString(candidate['hash'])) return errResult('head expectation requires a hash');
    return okResult();
  }
  return errResult('expectation kind must be absent or head');
};

export type U64AggregateVersion = ConsumedVersion;

export const isU64Version = (value: unknown): value is U64AggregateVersion => isU64Counter(value);

export const compareU64Version = (left: string, right: string): -1 | 0 | 1 => compareU64Counter(left, right);

export const nextU64Version = (value: string): U64AggregateVersion | undefined => nextU64Counter(value);

export interface U64AggregateUpdate {
  readonly key: string;
  readonly version: U64Counter;
  readonly value: EncodedValue;
}

export const validateU64AggregateUpdate = (update: unknown): ValidationResult => {
  if (typeof update !== 'object' || update === null) return errResult('update must be an object');
  const candidate = update as Record<string, unknown>;
  if (!isNonEmptyString(candidate['key'])) return errResult('update requires a key');
  if (!isU64Counter(candidate['version'])) return errResult('update requires a u64 version');
  if (!validateEncodedValue(candidate['value']).ok) return errResult('update requires an encoded value');
  return okResult();
};

export type U64RegisteredGuard =
  | { readonly kind: 'head'; readonly chainId: string; readonly hash: string }
  | { readonly kind: 'absent'; readonly chainId: string }
  | { readonly kind: 'aggregate-version'; readonly key: string; readonly version: U64Counter }
  | { readonly kind: 'predicate'; readonly predicateId: string; readonly dependency: string };

export const validateU64RegisteredGuard = (guard: unknown): ValidationResult => {
  if (typeof guard !== 'object' || guard === null) return errResult('guard must be an object');
  const candidate = guard as Record<string, unknown>;
  if (candidate['kind'] === 'aggregate-version') {
    if (!isNonEmptyString(candidate['key']) || !isU64Counter(candidate['version'])) return errResult('invalid aggregate guard');
    return okResult();
  }
  if (candidate['kind'] === 'head') {
    if (!isNonEmptyString(candidate['chainId']) || !isNonEmptyString(candidate['hash'])) return errResult('invalid head guard');
    return okResult();
  }
  if (candidate['kind'] === 'absent') {
    if (!isNonEmptyString(candidate['chainId'])) return errResult('invalid absent guard');
    return okResult();
  }
  if (candidate['kind'] === 'predicate') {
    if (!isNonEmptyString(candidate['predicateId']) || !isNonEmptyString(candidate['dependency'])) return errResult('invalid predicate guard');
    return okResult();
  }
  return errResult('unknown guard kind');
};

export type { ConsumedCounter, ConsumedVersion };

// E2 additive exact-u64 atomic unit: same structure as AtomicUnit, but
// aggregate versions, aggregate-version guards and absent allocations accept
// exact u64 decimal strings alongside legacy safe numbers. Legacy
// validateAtomicUnit stays frozen; the PG commit gate accepts a unit when
// either validator passes.
export type U64VersionInput = number | U64Counter;

export interface U64ChainAppend {
  readonly chainId: string;
  readonly record: { readonly id: string; readonly bytes: string; readonly hash: string };
  readonly expectation: ChainExpectation | U64ChainExpectation;
}

export interface U64AtomicUnit {
  readonly guards: readonly (RegisteredGuard | U64RegisteredGuard)[];
  readonly records: readonly RecordWrite[];
  readonly appends: readonly (ChainAppend | U64ChainAppend)[];
  readonly updates: readonly { readonly key: string; readonly version: U64VersionInput; readonly value: EncodedValue }[];
  readonly relationships: readonly RelationshipChange[];
  readonly barriers: readonly BarrierWrite[];
  readonly purgeIntents: readonly AuthorizedPurgeIntent[];
  readonly indexWrites: readonly IndexWrite[];
  readonly moduleResult?: EncodedValue;
}

const isU64VersionInput = (value: unknown): value is U64VersionInput =>
  (typeof value === 'number' && Number.isSafeInteger(value)) || isU64Counter(value);

export const validateU64AtomicUnit = (unit: U64AtomicUnit, limits?: WorkLimits): ValidationResult => {
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
    if (typeof append !== 'object' || append === null) { errors.push('append must be an object'); continue; }
    if (!isNonEmptyString(append.chainId)) errors.push('append requires a chainId');
    if (typeof append.record !== 'object' || append.record === null) errors.push('append requires a record');
    else {
      if (!isNonEmptyString(append.record.id)) errors.push('append record requires an id');
      if (typeof append.record.bytes !== 'string') errors.push('append record requires bytes');
      if (!isNonEmptyString(append.record.hash)) errors.push('append record requires a hash');
    }
    const expectation = validateU64ChainExpectation(append.expectation);
    if (!expectation.ok) errors.push(expectation.errors.join('; '));
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
      if (!isNonEmptyString(guard.key) || !isU64VersionInput(guard.version) || (typeof guard.version === 'number' && guard.version < 0)) errors.push('invalid aggregate guard');
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
    if (!isU64VersionInput(update.version) || (typeof update.version === 'number' && update.version < 0)) errors.push('update requires a version >= 0');
    const value = validateEncodedValue(update.value);
    if (!value.ok) errors.push(value.errors.join('; '));
  }
  for (const write of unit.indexWrites) {
    if (!write) { errors.push('index write must be an object'); continue; }
    if (!isNonEmptyString(write.key) || !isNonEmptyString(write.digest) || !Array.isArray(write.resultIds) || !write.resultIds.every(isNonEmptyString) || new Set(write.resultIds).size !== write.resultIds.length || (write.resultHash !== null && !isNonEmptyString(write.resultHash))) errors.push('index write must carry key, digest, unique non-empty result ids and result hash');
  }
  if (unit.moduleResult !== undefined && !validateEncodedValue(unit.moduleResult).ok) errors.push('module result must be an encoded value');
  return errors.length === 0 ? okResult() : errResult(...errors);
}

export { isPositiveSafeInteger };
