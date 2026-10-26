// Shared exact-u64 vectors for generic storage (E1).
// Data-only: boundary strings and invalid inputs. No I/O, no clock.
// Runners accept injected helpers so the same corpus covers the new
// storage u64 module without importing it here.

export const U64_MAX = '18446744073709551615';

export const U64_VALID_VECTORS: readonly string[] = [
  '0',
  '1',
  '9007199254740991',
  '9007199254740992',
  '9223372036854775807',
  '9223372036854775808',
  '18446744073709551614',
  U64_MAX,
];

export const U64_INVALID_VECTORS: readonly unknown[] = [
  '',
  '01',
  '00',
  '-1',
  '-0',
  '1.0',
  ' 1',
  '1 ',
  '18446744073709551616',
  '99999999999999999999999999',
  '0x10',
  0,
  1,
  9007199254740991,
  null,
  undefined,
  {},
  [],
];

export const U64_ORDERED_PAIRS: ReadonlyArray<readonly [string, string, -1 | 0 | 1]> = [
  ['0', '1', -1],
  ['1', '1', 0],
  ['9007199254740991', '9007199254740992', -1],
  ['9223372036854775807', '9223372036854775808', -1],
  ['18446744073709551614', U64_MAX, -1],
  [U64_MAX, U64_MAX, 0],
];

export const U64_SUCCESSOR_CASES: ReadonlyArray<readonly [string, string | undefined]> = [
  ['0', '1'],
  ['9007199254740991', '9007199254740992'],
  ['9223372036854775807', '9223372036854775808'],
  ['18446744073709551614', U64_MAX],
  [U64_MAX, undefined],
];

export interface U64CounterHelpers {
  readonly isU64Counter: (value: unknown) => boolean;
  readonly parseU64Counter: (value: unknown) => bigint | null;
  readonly compareU64Counter: (left: string, right: string) => -1 | 0 | 1;
  readonly nextU64Counter: (value: string) => string | undefined;
  readonly maxU64Counter: () => string;
}

export const runU64CounterCorpus = (helpers: U64CounterHelpers): void => {
  for (const valid of U64_VALID_VECTORS) {
    if (!helpers.isU64Counter(valid)) throw new Error(`must accept ${valid}`);
    const parsed = helpers.parseU64Counter(valid);
    if (parsed !== BigInt(valid)) throw new Error(`must parse ${valid} exactly`);
  }
  for (const invalid of U64_INVALID_VECTORS) {
    if (helpers.isU64Counter(invalid)) throw new Error(`must reject ${String(invalid)}`);
    if (helpers.parseU64Counter(invalid) !== null) throw new Error(`must not parse ${String(invalid)}`);
  }
  for (const [left, right, expected] of U64_ORDERED_PAIRS) {
    if (helpers.compareU64Counter(left, right) !== expected) {
      throw new Error(`ordering ${left} vs ${right} must be ${expected}`);
    }
  }
  for (const [input, expected] of U64_SUCCESSOR_CASES) {
    if (helpers.nextU64Counter(input) !== expected) {
      throw new Error(`successor of ${input} must be ${String(expected)}`);
    }
  }
  if (helpers.maxU64Counter() !== U64_MAX) throw new Error('max must be 2^64-1');
  if (typeof helpers.parseU64Counter(U64_MAX) !== 'bigint') {
    throw new Error('max must parse without Number');
  }
};
