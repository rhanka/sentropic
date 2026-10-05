export const JUDGE_MAX_JSON_BYTES = 256 * 1024;
export const JUDGE_MAX_JSON_DEPTH = 16;
export const JUDGE_MAX_RAW_BYTES = 16 * 1024;
const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export const has = (value: object, key: string): boolean => Object.hasOwn(value, key);
export const hasOnlyKeys = (value: object, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key));
export const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
export const isMicroUsd = (value: unknown): value is string =>
  typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
export const isCorrelationId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);

/** Check before serialization: JSON.stringify otherwise drops or coerces invalid data. */
function isJson(value: unknown, depth: number): boolean {
  if (depth > JUDGE_MAX_JSON_DEPTH) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) return false;
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (array && Object.keys(descriptors).length !== value.length + 1) return false;
  return Object.entries(descriptors).every(([key, descriptor]) => {
    if (array && key === 'length') return true;
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) return false;
    return !unsafeKeys.has(key) && descriptor.enumerable === true
      && has(descriptor, 'value') && isJson(descriptor.value, depth + 1);
  });
}

export function isBoundedJson(value: unknown, maxBytes = JUDGE_MAX_JSON_BYTES): boolean {
  try {
    return isJson(value, 0) && new TextEncoder().encode(JSON.stringify(value)).byteLength <= maxBytes;
  } catch {
    return false;
  }
}
