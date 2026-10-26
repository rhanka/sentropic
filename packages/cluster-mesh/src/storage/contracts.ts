// K1 shared contract primitives (L3a v4.1 frozen §2.3, §4.1). Data-pure: no I/O,
// no clock, no crypto. All validators are total functions.
// E1 additive: exact-u64 consumed paths are opt-in; legacy decimal
// counters stay safe-integer only and keep their frozen behavior.

import {
  compareU64Counter,
  isPositiveU64Counter,
  isU64Counter,
  maxU64Counter,
  nextU64Counter,
  parsePositiveU64Counter,
  parseU64Counter,
  type U64Counter,
} from './u64.js';

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export const okResult = (): ValidationResult => ({ ok: true, errors: [] });

export const errResult = (...errors: readonly string[]): ValidationResult => ({
  ok: false,
  errors,
});

export const STORAGE_MODULE_IDS = ['comments', 'engram-live', 'engram-memory'] as const;
export type StorageModuleId = (typeof STORAGE_MODULE_IDS)[number];

export const isStorageModuleId = (value: unknown): value is StorageModuleId =>
  typeof value === 'string' && (STORAGE_MODULE_IDS as readonly string[]).includes(value);

export interface StorageScope {
  readonly tenantId: string;
  readonly workspaceId: string;
}

const MAX_ID_LENGTH = 256;

const isSafeId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= MAX_ID_LENGTH &&
  !value.includes('\0');

export const validateStorageScope = (scope: unknown): ValidationResult => {
  if (typeof scope !== 'object' || scope === null) return errResult('scope must be an object');
  const candidate = scope as Record<string, unknown>;
  if (!isSafeId(candidate['tenantId'])) return errResult('scope.tenantId must be a non-empty id');
  if (!isSafeId(candidate['workspaceId'])) return errResult('scope.workspaceId must be a non-empty id');
  return okResult();
};

export const encodeCompoundKey = (parts: readonly string[]): string => JSON.stringify(parts);

export const decodeCompoundKey = (key: unknown): readonly string[] | null => {
  if (typeof key !== 'string') return null;
  try {
    const parsed: unknown = JSON.parse(key);
    if (!Array.isArray(parsed) || !parsed.every((entry) => typeof entry === 'string')) return null;
    return parsed as readonly string[];
  } catch {
    return null;
  }
};

export const STORAGE_OPERATIONS = ['read', 'write', 'publish', 'maintain'] as const;
export type StorageOperation = (typeof STORAGE_OPERATIONS)[number];

export const isStorageOperation = (value: unknown): value is StorageOperation =>
  typeof value === 'string' && (STORAGE_OPERATIONS as readonly string[]).includes(value);

export type GrantLifetime =
  | { readonly kind: 'invocation'; readonly invocationId: string }
  | { readonly kind: 'lease'; readonly expiresAt: string };

export const validateGrantLifetime = (lifetime: unknown, nowIso?: string): ValidationResult => {
  if (typeof lifetime !== 'object' || lifetime === null) return errResult('lifetime must be an object');
  const candidate = lifetime as Record<string, unknown>;
  if (candidate['kind'] === 'invocation') {
    if (!isSafeId(candidate['invocationId'])) return errResult('invocation lifetime requires an invocationId');
    return okResult();
  }
  if (candidate['kind'] === 'lease') {
    if (!isIsoDateString(candidate['expiresAt'])) return errResult('lease lifetime requires an ISO expiresAt');
    if (nowIso !== undefined) {
      if (!isIsoDateString(nowIso)) return errResult('now must be an ISO date string');
      if (Date.parse(candidate['expiresAt'] as string) <= Date.parse(nowIso)) return errResult('lease is expired');
    }
    return okResult();
  }
  return errResult('lifetime.kind must be invocation or lease');
};

export interface EncodedValue {
  readonly format: 'utf8' | 'base64';
  readonly data: string;
}

export const validateEncodedValue = (value: unknown): ValidationResult => {
  if (typeof value !== 'object' || value === null) return errResult('encoded value must be an object');
  const candidate = value as Record<string, unknown>;
  if (candidate['format'] !== 'utf8' && candidate['format'] !== 'base64') {
    return errResult('encoded value format must be utf8 or base64');
  }
  if (typeof candidate['data'] !== 'string') return errResult('encoded value data must be a string');
  return okResult();
};

export type DecimalCounter = string;

export const DECIMAL_COUNTER_RE = /^(0|[1-9][0-9]*)$/;
export const ZERO_COUNTER: DecimalCounter = '0';

export const isDecimalCounter = (value: unknown): value is DecimalCounter =>
  typeof value === 'string' && DECIMAL_COUNTER_RE.test(value) && Number.isSafeInteger(Number(value));

export const parseDecimalCounter = (value: unknown): number | null => {
  if (!isDecimalCounter(value)) return null;
  return Number(value);
};

export const incrementDecimalCounter = (value: DecimalCounter): DecimalCounter | null => {
  const parsed = parseDecimalCounter(value);
  if (parsed === null || !Number.isSafeInteger(parsed + 1)) return null;
  return String(parsed + 1);
};

// E1 opt-in consumed counter/version: exact u64 transport for durable
// counters and versions that must cross 2^53/2^63. Legacy DecimalCounter
// behavior above stays frozen and safe-integer only.
export type ConsumedCounter = U64Counter;
export type ConsumedVersion = U64Counter;

export const MAX_CONSUMED_COUNTER: ConsumedCounter = '18446744073709551615';

export const isConsumedCounter = (value: unknown): value is ConsumedCounter => isU64Counter(value);

export const parseConsumedCounter = (value: unknown): bigint | null => parseU64Counter(value);

export const isConsumedVersion = (value: unknown): value is ConsumedVersion => isU64Counter(value);

export const parseConsumedVersion = (value: unknown): bigint | null => parseU64Counter(value);

export const compareConsumedCounter = (left: string, right: string): -1 | 0 | 1 => compareU64Counter(left, right);

export const nextConsumedCounter = (value: string): ConsumedCounter | undefined => nextU64Counter(value);

export const maxConsumedCounter = (): ConsumedCounter => maxU64Counter();

export { compareU64Counter, isPositiveU64Counter, isU64Counter, maxU64Counter, nextU64Counter, parsePositiveU64Counter, parseU64Counter };
export type { U64Counter };

export const isSafeInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value);

export const isPositiveSafeInteger = (value: unknown): value is number =>
  isSafeInteger(value) && value > 0;

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;

export const isIsoDateString = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_RE.test(value) && !Number.isNaN(Date.parse(value));

export const isHexDigest = (value: unknown, bytes = 32): value is string =>
  typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value);

export interface WorkLimits {
  readonly maxRecords: number;
  readonly maxAppends: number;
  readonly maxEncodedBytes: number;
}

export const DEFAULT_WORK_LIMITS: WorkLimits = { maxRecords: 128, maxAppends: 128, maxEncodedBytes: 524288 };

export const validateWorkLimits = (limits: unknown): ValidationResult => {
  if (typeof limits !== 'object' || limits === null) return errResult('work limits must be an object');
  const candidate = limits as Record<string, unknown>;
  if (!isPositiveSafeInteger(candidate['maxRecords'])) return errResult('maxRecords must be positive');
  if (!isPositiveSafeInteger(candidate['maxAppends'])) return errResult('maxAppends must be positive');
  if (!isPositiveSafeInteger(candidate['maxEncodedBytes'])) return errResult('maxEncodedBytes must be positive');
  return okResult();
};

export interface PageLimits {
  readonly maxRecords: number;
  readonly maxEncodedBytes: number;
}

export const DEFAULT_PAGE_LIMITS: PageLimits = { maxRecords: 100, maxEncodedBytes: 1048576 };

export const validatePageLimits = (limits: unknown): ValidationResult => {
  if (typeof limits !== 'object' || limits === null) return errResult('page limits must be an object');
  const candidate = limits as Record<string, unknown>;
  if (!isPositiveSafeInteger(candidate['maxRecords'])) return errResult('maxRecords must be positive');
  if (!isPositiveSafeInteger(candidate['maxEncodedBytes'])) return errResult('maxEncodedBytes must be positive');
  return okResult();
};

export type StoreIncarnation = string;

export const validateStoreIncarnation = (value: unknown): ValidationResult =>
  isSafeId(value) ? okResult() : errResult('incarnation must be a non-empty id');

export interface WriterFence {
  readonly fenceId: string;
  readonly epoch: DecimalCounter;
}

export const validateWriterFence = (fence: unknown): ValidationResult => {
  if (typeof fence !== 'object' || fence === null) return errResult('fence must be an object');
  const candidate = fence as Record<string, unknown>;
  if (!isSafeId(candidate['fenceId'])) return errResult('fence requires a fenceId');
  if (!isDecimalCounter(candidate['epoch'])) return errResult('fence requires a decimal epoch');
  return okResult();
};
