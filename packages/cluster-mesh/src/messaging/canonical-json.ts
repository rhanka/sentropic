import { createHash } from 'node:crypto';

const encode = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  if (typeof value !== 'object') throw new TypeError('Value is not canonical JSON');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('JSON objects must be plain records');
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => {
    if (record[key] === undefined) throw new TypeError('Undefined is not canonical JSON');
    return `${JSON.stringify(key)}:${encode(record[key])}`;
  }).join(',')}}`;
};

export const canonicalJson = (value: unknown): string => encode(value);
export const canonicalEqual = (left: unknown, right: unknown): boolean =>
  canonicalJson(left) === canonicalJson(right);
export const canonicalBytes = (value: unknown): number =>
  Buffer.byteLength(canonicalJson(value), 'utf8');

export const nativeIdempotencyKey = (input: {
  readonly sourceId: string;
  readonly sourceEpoch: string;
  readonly nativeMessageId: string;
}): string => `native/v1:${createHash('sha256').update(canonicalJson(input)).digest('base64url')}`;
