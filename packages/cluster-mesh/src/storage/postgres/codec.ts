import { PostgresStorageError } from './errors.js';

const corrupt = (): never => { throw new PostgresStorageError('corruption'); };
export const decodePgText = (value: unknown): string => typeof value === 'string' ? value : corrupt();
export const decodePgCounter = (value: unknown): string => {
  if (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  if (typeof value === 'bigint' && value >= 0n) return String(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return corrupt();
};
export const decodePgBytes = (value: unknown): Buffer => value instanceof Uint8Array ? Buffer.from(value) : corrupt();
// Exact-u64 semantic counters (E2): canonical decimal strings covering the
// full 0..2^64-1 range with BigInt end to end. Numbers are never accepted:
// every Number conversion of an above-safe counter is lossy, so no numeric
// input path exists by construction.
const U64_COUNTER_RE = /^(0|[1-9][0-9]*)$/;
const MAX_U64_COUNTER = 18446744073709551615n;
export const decodePgCounterU64 = (value: unknown): string => {
  if (typeof value === 'string' && U64_COUNTER_RE.test(value)) {
    try {
      if (BigInt(value) <= MAX_U64_COUNTER) return value;
    } catch { /* fall through to corrupt */ }
  } else if (typeof value === 'bigint' && value >= 0n && value <= MAX_U64_COUNTER) {
    return String(value);
  }
  return corrupt();
};
export const decodePgUtf8 = (value: unknown): string => {
  const bytes = decodePgBytes(value);
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { return corrupt(); }
};
export const decodePgJson = <T>(value: unknown): T => {
  if (typeof value !== 'string') return corrupt();
  try { return JSON.parse(value) as T; } catch { return corrupt(); }
};
export const decodePgBoolean = (value: unknown): boolean => typeof value === 'boolean' ? value : corrupt();
