import type { JudgeRequest, Json } from './request.js';
import type { JudgeVerdict } from './verdict.js';
import { hasOnlyKeys, isRecord, snapshotBoundedJson } from './validation.js';

const fields = ['noul', 'score', 'choice', 'probabilities', 'confidence'] as const;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
const limit = (request: JudgeRequest) => Math.min(16384, request.raw?.maxBytes ?? 16384);

/** Drop whole optional native fields to fit; never truncate the typed verdict. */
export function makeJevProviderRaw(native: unknown, request: JudgeRequest): JudgeVerdict['providerRaw'] {
  if (request.raw?.mode !== 'allowlisted' || limit(request) < 2) return undefined;
  const snapshot = snapshotBoundedJson(native);
  if (!snapshot.ok || !isRecord(snapshot.value)) return undefined;
  const data: Record<string, Json> = {};
  let truncated = false;
  for (const field of fields) {
    if (!Object.hasOwn(snapshot.value, field)) continue;
    const next = { ...data, [field]: snapshot.value[field] };
    if (bytes(next) > limit(request)) { truncated = true; continue; }
    data[field] = snapshot.value[field] as Json;
  }
  return { data, bytes: bytes(data), truncated };
}

/** Raw remains optional, bounded and tied to the already validated native evidence. */
export function parseJevProviderRaw(candidate: unknown, native: unknown, request: JudgeRequest): JudgeVerdict['providerRaw'] | null {
  const snapshot = snapshotBoundedJson(candidate);
  if (request.raw?.mode !== 'allowlisted' || !snapshot.ok || !isRecord(snapshot.value) || !isRecord(native)) return null;
  const value = snapshot.value;
  if (!hasOnlyKeys(value, ['data', 'bytes', 'truncated']) || !isRecord(value.data) || !hasOnlyKeys(value.data, fields)
    || typeof value.truncated !== 'boolean' || value.bytes !== bytes(value.data) || bytes(value.data) > limit(request)) return null;
  const rawData = value.data;
  for (const [field, data] of Object.entries(rawData)) {
    if (!Object.hasOwn(native, field)) return null;
    const expected = native[field];
    if (isRecord(data) && isRecord(expected)) {
      if (Object.keys(data).length !== Object.keys(expected).length
        || !Object.keys(data).every((key) => data[key] === expected[key])) return null;
    } else if (data !== native[field]) return null;
  }
  const omitted = fields.some((field) => Object.hasOwn(native, field) && !Object.hasOwn(rawData, field));
  if (value.truncated !== omitted) return null;
  return { data: value.data as Json, bytes: value.bytes as number, truncated: value.truncated };
}
