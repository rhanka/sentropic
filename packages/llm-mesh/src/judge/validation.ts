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

/** Copy data descriptors only; never serialize or read fields from the live caller object. */
function copyJson(value: unknown, depth: number, budget: { remaining: number }): unknown {
  if (--budget.remaining < 0 || depth > JUDGE_MAX_JSON_DEPTH) throw new Error('Invalid JSON.');
  if (typeof value === 'string') {
    budget.remaining -= value.length;
    if (budget.remaining < 0) throw new Error('Invalid JSON.');
    return value;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || Object.getOwnPropertySymbols(value).length) throw new Error('Invalid JSON.');
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) throw new Error('Invalid JSON.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const length = descriptors.length?.value;
  if (array && (!Number.isSafeInteger(length) || length < 0
    || Object.keys(descriptors).length !== length + 1)) throw new Error('Invalid JSON.');
  const copy: Record<string, unknown> = array ? [] as unknown as Record<string, unknown> : Object.create(null);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= length)) throw new Error('Invalid JSON.');
    if (unsafeKeys.has(key) || descriptor.enumerable !== true || !has(descriptor, 'value')) throw new Error('Invalid JSON.');
    // Node visits and text lengths are lower bounds on serialized bytes, including shared paths.
    if (!array) budget.remaining -= key.length;
    if (budget.remaining < 0) throw new Error('Invalid JSON.');
    copy[key] = copyJson(descriptor.value, depth + 1, budget);
  }
  return copy;
}

export function snapshotBoundedJson(value: unknown, maxBytes = JUDGE_MAX_JSON_BYTES):
  { ok: true; value: unknown } | { ok: false } {
  try {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return { ok: false };
    const copy = copyJson(value, 0, { remaining: maxBytes });
    const serialized = JSON.stringify(copy);
    if (new TextEncoder().encode(serialized).byteLength > maxBytes) return { ok: false };
    return { ok: true, value: JSON.parse(serialized) as unknown };
  } catch {
    return { ok: false };
  }
}

export const isBoundedJson = (value: unknown, maxBytes = JUDGE_MAX_JSON_BYTES): boolean =>
  snapshotBoundedJson(value, maxBytes).ok;
