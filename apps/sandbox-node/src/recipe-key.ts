import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import type { DsRecipeKeyV1 } from './contract.js';

/** RFC 8785 for JSON input: UTF-16 key ordering and ECMAScript number encoding. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  throw new Error('invalid canonical JSON value');
}

export function dsRecipeKey(input: DsRecipeKeyV1): string {
  const sources: Record<string, string> = {};
  for (const [path, source] of Object.entries(input.sources)) {
    const normalized = posix.normalize(path);
    if (!path || path.includes('\\') || path.includes('\0') || posix.isAbsolute(path)
      || normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
      throw Object.assign(new Error('INVALID_SOURCE_PATH'), { status: 400 });
    }
    if (Object.hasOwn(sources, normalized)) {
      throw Object.assign(new Error('DUPLICATE_NORMALIZED_PATH'), { status: 400 });
    }
    Object.defineProperty(sources, normalized, { value: source, enumerable: true });
  }
  return `sha256:${createHash('sha256').update(canonicalJson({ ...input, sources })).digest('hex')}`;
}
