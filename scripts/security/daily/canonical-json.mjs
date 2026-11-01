import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('canonicalize: only integer numbers are supported');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const body = keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',');
    return `{${body}}`;
  }
  throw new Error('canonicalize: unsupported value type');
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function keyId(prefix, parts) {
  return `${prefix}${sha256Hex(canonicalize(parts))}`;
}
