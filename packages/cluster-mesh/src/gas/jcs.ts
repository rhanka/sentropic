// RFC 8785 (JCS) for JSON.parse output, plus the payload digest. Pure: no TextEncoder, no crypto (DigestPort only).
// Lone surrogates are refused (N3 r3 A5).
import { StoreRefusedError } from './errors.js';
import { sha256Utf8, utf8Bytes, type DigestPort } from './digest.js';

function assertWellFormed(s: string): void {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (d < 0xdc00 || d > 0xdfff) throw new StoreRefusedError('not_canonical', 'lone surrogate');
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) throw new StoreRefusedError('not_canonical', 'lone surrogate');
  }
}

export function canonicalize(v: unknown): string {
  if (v === null) return 'null';
  if (typeof v === 'string') {
    assertWellFormed(v);
    return JSON.stringify(v);
  }
  if (typeof v === 'number') {
    if (!isFinite(v)) throw new StoreRefusedError('not_canonical', 'non-finite number');
    return JSON.stringify(v);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(canonicalize).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as { [k: string]: unknown };
    const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return '{' + keys.map((k) => { assertWellFormed(k); return JSON.stringify(k) + ':' + canonicalize(o[k]); }).join(',') + '}';
  }
  throw new StoreRefusedError('not_canonical', 'unsupported type ' + typeof v);
}

/** The integrity bytes source of mode (b): the UTF-8 bytes of JCS(payload) as sealed in the envelope. */
export function payloadDigest(digest: DigestPort, payload: unknown): { sha256: string; bytes: number } {
  const text = canonicalize(payload);
  return { sha256: sha256Utf8(digest, text), bytes: utf8Bytes(text).length };
}
