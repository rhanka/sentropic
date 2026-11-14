import { hash } from '@stablelib/sha256';

export class CompileContractError extends Error {
  constructor(readonly code: string) { super(code); this.name = 'CompileContractError'; }
}
const fail = (): never => { throw new CompileContractError('invalid_recipe'); };
const scalarString = (value: string): string => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) fail();
    } else if (code >= 0xdc00 && code <= 0xdfff) fail();
  }
  return JSON.stringify(value);
};
/** RFC 8785: UTF-16 key order, ECMAScript numbers, no Unicode normalization. */
export function compileCanonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  function encode(input: unknown, depth: number): string {
    if (depth > 64) return fail();
    if (input === null) return 'null';
    if (typeof input === 'string') return scalarString(input);
    if (typeof input === 'boolean') return input ? 'true' : 'false';
    if (typeof input === 'number') return Number.isFinite(input) ? JSON.stringify(input) : fail();
    if (typeof input !== 'object' || ancestors.has(input)) return fail();
    ancestors.add(input);
    let encoded: string;
    if (Array.isArray(input)) {
      if (Reflect.ownKeys(input).length !== input.length + 1) return fail();
      encoded = '[' + Array.from({ length: input.length }, (_, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor?.enumerable || !('value' in descriptor)) return fail();
        return encode(descriptor.value, depth + 1);
      }).join(',') + ']';
    } else {
      if (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) return fail();
      if (Object.getOwnPropertySymbols(input).length) return fail();
      encoded = '{' + Object.getOwnPropertyNames(input).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) return fail();
        return scalarString(key) + ':' + encode(descriptor.value, depth + 1);
      }).join(',') + '}';
    }
    ancestors.delete(input);
    return encoded;
  }
  return encode(value, 0);
}
export function compileSha256(bytes: Uint8Array): string {
  return Array.from(hash(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export const compileJsonDigest = (value: unknown): string =>
  compileSha256(new TextEncoder().encode(compileCanonicalJson(value)));
export function normalizeCompilePath(path: string): string {
  scalarString(path);
  const normalized = path.normalize('NFC');
  if (!normalized || normalized.startsWith('/') || /[\\:\u0000-\u001f\u007f]/u.test(normalized)
    || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new CompileContractError('invalid_source_path');
  }
  return normalized;
}
export function compileDecodeBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) return fail();
  const binary = atob(value);
  if (btoa(binary) !== value) return fail();
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
export function compileSri(sha256: string): string {
  if (!/^[a-f0-9]{64}$/u.test(sha256)) return fail();
  return 'sha256-' + btoa(sha256.match(/../gu)!.map(byte => String.fromCharCode(parseInt(byte, 16))).join(''));
}
