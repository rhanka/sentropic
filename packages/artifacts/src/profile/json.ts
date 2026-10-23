import { createHash } from 'node:crypto';
import type { JsonValue } from '../contracts.js';
import { ArtifactProfileInputError } from './contracts.js';

/** Reject before UTF-8 conversion can replace an unpaired code unit. */
export function assertWellFormed(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new ArtifactProfileInputError();
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new ArtifactProfileInputError();
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** An owned JSON snapshot, refusing non-JSON, accessors and cyclic inputs. */
export function copyJson(value: unknown, ancestors = new Set<object>()): JsonValue {
  if (typeof value === 'string') { assertWellFormed(value); return value; }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new ArtifactProfileInputError();
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Array.from(value, (entry) => copyJson(entry, ancestors));
    }
    if (!isRecord(value) || Object.getOwnPropertySymbols(value).length) throw new ArtifactProfileInputError();
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value)) {
      assertWellFormed(key);
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!('value' in descriptor)) throw new ArtifactProfileInputError();
      Object.defineProperty(out, key, { value: copyJson(descriptor.value, ancestors), enumerable: true,
        writable: true, configurable: true });
    }
    return out;
  } finally { ancestors.delete(value); }
}

export function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Command/profile codec: objects sort recursively; arrays retain order. */
export function orderedJson(value: unknown): string {
  const canonicalize = (entry: JsonValue): string => {
    if (Array.isArray(entry)) return `[${entry.map(canonicalize).join(',')}]`;
    if (entry !== null && typeof entry === 'object') {
      return `{${Object.keys(entry).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalize(entry[key]!)}`).join(',')}}`;
    }
    return JSON.stringify(entry);
  };
  return canonicalize(copyJson(value));
}
export function orderedDigest(value: unknown): string {
  return createHash('sha256').update(orderedJson(value), 'utf8').digest('hex');
}
