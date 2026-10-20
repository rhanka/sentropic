// engram-memory codec: canonical JCS (RFC 8785) with NFC normalization,
// compound identity-key helpers and canonical u64 decimal transport.
// Data-pure: no I/O, no clock, no crypto. Mirrors the co-signed Engram
// neutral declarations byte-for-byte; no import from Engram.

export class MemoryCanonicalJsonError extends Error {
  constructor(message = 'Value is not canonical JSON') {
    super(message);
    this.name = 'MemoryCanonicalJsonError';
  }
}

export type MemoryCanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | MemoryCanonicalJsonValue[]
  | { [key: string]: MemoryCanonicalJsonValue };

const hasUnpairedSurrogate = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
};

const isPlainObject = (value: object): value is Record<string, unknown> => {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const normalizeMemoryCanonicalJson = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): MemoryCanonicalJsonValue => {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) throw new MemoryCanonicalJsonError('string contains an unpaired surrogate');
    return value.normalize('NFC');
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new MemoryCanonicalJsonError('number is not canonical JSON');
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new MemoryCanonicalJsonError('integer is outside the safe range');
    }
    return value;
  }
  if (typeof value !== 'object' || typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new MemoryCanonicalJsonError('value is not JSON');
  }
  if (seen.has(value)) throw new MemoryCanonicalJsonError('cyclic value is not JSON');
  seen.add(value);
  if (Array.isArray(value)) {
    const extraKeys = Object.keys(value).filter((key) => !/^(0|[1-9][0-9]*)$/.test(key));
    if (extraKeys.length > 0) throw new MemoryCanonicalJsonError('array has non-index properties');
    const normalized = value.map((item) => normalizeMemoryCanonicalJson(item, seen));
    seen.delete(value);
    return normalized;
  }
  if (!isPlainObject(value) || Object.getOwnPropertySymbols(value).length > 0) {
    throw new MemoryCanonicalJsonError('value is not a plain JSON object');
  }
  const normalized: Record<string, MemoryCanonicalJsonValue> = {};
  for (const rawKey of Object.keys(value)) {
    if (hasUnpairedSurrogate(rawKey)) throw new MemoryCanonicalJsonError('object key contains an unpaired surrogate');
    const key = rawKey.normalize('NFC');
    if (Object.hasOwn(normalized, key)) throw new MemoryCanonicalJsonError('duplicate key after NFC normalization');
    normalized[key] = normalizeMemoryCanonicalJson((value as Record<string, unknown>)[rawKey], seen);
  }
  seen.delete(value);
  return normalized;
};

const stringifyCanonicalJson = (value: MemoryCanonicalJsonValue): string => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value) as string;
  }
  if (Array.isArray(value)) return `[${value.map(stringifyCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stringifyCanonicalJson(value[key] as MemoryCanonicalJsonValue)}`).join(',')}}`;
};

/** RFC 8785 JSON Canonicalization Scheme bytes with NFC normalization. */
export const canonicalizeMemoryJcs = (value: unknown): string =>
  stringifyCanonicalJson(normalizeMemoryCanonicalJson(value));

export interface MemoryEncodedValue {
  readonly format: 'utf8';
  readonly data: string;
}

export const memoryUtf8 = (data: string): MemoryEncodedValue => ({ format: 'utf8', data });

/** JCS bytes of an NFC-normalized value (binding section 3.2). */
export const memoryJcs = (value: unknown): MemoryEncodedValue => ({ format: 'utf8', data: canonicalizeMemoryJcs(value) });

/** Compound identity-key encodings (binding section 3.1). */
export const memoryRecordKey = (recordId: string): string => JSON.stringify(['memory-record-v1', recordId]);

export const memoryControlKey = (candidateId: string): string =>
  JSON.stringify(['memory-pending-control-v1', candidateId]);

export const memoryEnvelopeKey = (candidateId: string): string =>
  JSON.stringify(['memory-sealed-envelope-v1', candidateId]);

export const memoryStateKey = (entityKind: 'candidate' | 'record', entityId: string): string =>
  JSON.stringify(['memory-state-v1', entityKind, entityId]);

export const memoryOutboxKey = (throughCursorInclusive: string, batchDigest: string): string =>
  JSON.stringify(['memory-outbox-v1', throughCursorInclusive, batchDigest]);

export const memoryCaptureKey = (candidateId: string): string =>
  JSON.stringify(['memory-capture-idempotency-v1', candidateId]);

export const memoryOutcomeKey = (candidateId: string): string =>
  JSON.stringify(['memory-admission-outcome-v1', candidateId]);

export const memoryStoreMetaKey = (): string => JSON.stringify(['memory-store-meta-v1', 'binding']);

export const memoryLexicalKey = (scopeRef: string, recordId: string): string =>
  JSON.stringify(['memory-lexical-v1', scopeRef, recordId]);

/**
 * Canonical lexical removal marker (binding section 3.4 rule 2): the neutral
 * index write carries no delete primitive, so a transition out of
 * `accepted_current` writes the JCS null tombstone under the same key in the
 * same unit. Readers treat the tombstone as absent.
 */
export const memoryLexicalTombstone = (): MemoryEncodedValue => ({ format: 'utf8', data: 'null' });

/** Readers treat the tombstone as absent; recovery never resurrects it. */
export const isMemoryLexicalTombstone = (value: MemoryEncodedValue): boolean =>
  value.format === 'utf8' && value.data === 'null';

/** The single journal chain identity (binding section 7.4). */
export const memoryJournalChain = (): string => 'memory-journal';

/** Zero hash opening a genesis chain (binding section 8.1). */
export const memoryZeroHash = (): string => `sha256:${'0'.repeat(64)}`;

const MAX_U64 = 18_446_744_073_709_551_615n;
const U64_PATTERN = /^(0|[1-9][0-9]*)$/;

/** Canonical unsigned-64 decimal transport: BigInt end to end, never Number. */
export const isCanonicalU64 = (value: unknown): value is string => {
  if (typeof value !== 'string' || !U64_PATTERN.test(value)) return false;
  try {
    return BigInt(value) <= MAX_U64;
  } catch {
    return false;
  }
};

export const compareU64 = (left: string, right: string): number => {
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
};

/** Successor, or undefined at u64 exhaustion (refusal only at 2^64 - 1, never a wrap). */
export const nextU64 = (value: string): string | undefined => {
  const next = BigInt(value) + 1n;
  return next > MAX_U64 ? undefined : next.toString();
};

export const maxU64 = (): string => MAX_U64.toString();
