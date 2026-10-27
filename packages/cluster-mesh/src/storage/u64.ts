// Exact unsigned-64 decimal counters for generic storage (E1).
// Data-pure: no I/O, no clock, no crypto. BigInt end to end, never Number.
// Canonical form forbids leading zeros; the maximum is 2^64 - 1.

export type U64Counter = string;

export const U64_COUNTER_RE = /^(0|[1-9][0-9]*)$/;

export const MAX_U64_COUNTER: U64Counter = '18446744073709551615';

export const ZERO_U64_COUNTER: U64Counter = '0';

const MAX_U64 = 18_446_744_073_709_551_615n;

const fail = (message: string): never => {
  throw new Error(message);
};

/** Canonical unsigned-64 decimal transport: BigInt range check, never Number. */
export const isU64Counter = (value: unknown): value is U64Counter => {
  if (typeof value !== 'string' || !U64_COUNTER_RE.test(value)) return false;
  try {
    return BigInt(value) <= MAX_U64;
  } catch {
    return false;
  }
};

/** Exact parse to BigInt, or null when the value is not a canonical u64. */
export const parseU64Counter = (value: unknown): bigint | null => {
  if (!isU64Counter(value)) return null;
  return BigInt(value);
};

/** Exact three-way comparison with BigInt, no precision loss. */
export const compareU64Counter = (left: string, right: string): -1 | 0 | 1 => {
  if (!isU64Counter(left)) fail(`invalid u64 counter: ${left}`);
  if (!isU64Counter(right)) fail(`invalid u64 counter: ${right}`);
  const a = BigInt(left);
  const b = BigInt(right);
  return a === b ? 0 : a < b ? -1 : 1;
};

/** Successor, or undefined at u64 exhaustion (no wrap). */
export const nextU64Counter = (value: string): U64Counter | undefined => {
  if (!isU64Counter(value)) fail(`invalid u64 counter: ${value}`);
  const next = BigInt(value) + 1n;
  return next > MAX_U64 ? undefined : (next.toString() as U64Counter);
};

export const maxU64Counter = (): U64Counter => MAX_U64_COUNTER;

/** Positive u64 (>= 1): the epoch domain for canonical ownership. */
export const isPositiveU64Counter = (value: unknown): value is U64Counter =>
  isU64Counter(value) && (value as string) !== '0';

/** Exact parse of a positive u64 epoch, or null when out of domain. */
export const parsePositiveU64Counter = (value: unknown): bigint | null => {
  if (!isPositiveU64Counter(value)) return null;
  return BigInt(value as string);
};
