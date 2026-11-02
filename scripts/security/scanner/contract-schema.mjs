import { digest } from '../daily/toolchain-contract.mjs';

export const requireContract = (condition, field) => {
  if (!condition) throw new Error(`scanner-contract: ${field}`);
};
export const text = value => typeof value === 'string' && value.length > 0;
export const integer = value => Number.isSafeInteger(value) && value > 0;
export const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
export const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const version = value => typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
export const path = value => text(value) && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(value) &&
  !value.split('/').some(part => ['', '.', '..'].includes(part));
export const timestamp = value => typeof value === 'string' &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) && Number.isFinite(Date.parse(value));
export const literal = expected => value => value === expected;
export const list = rule => value => Array.isArray(value) && value.length > 0 && value.every(rule);
export const empty = value => Array.isArray(value) && value.length === 0;
export const record = shape => value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).length === Object.keys(shape).length &&
  Object.entries(shape).every(([key, rule]) => Object.hasOwn(value, key) && rule(value[key]));
export const descriptor = record({ path, digest: hash, size: integer });
export const equal = (a, b) => {
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
};
export const measured = (entry, files) => {
  const bytes = files?.[entry.path];
  requireContract(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length === entry.size &&
    digest(bytes) === entry.digest, `measured bytes: ${entry.path}`);
};
export const CONTRACT_ONLY = Object.freeze({ contractValid: true, productionAdmitted: false });
