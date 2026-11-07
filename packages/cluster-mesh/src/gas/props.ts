// Chunked string storage over a Properties-like store. Values stay under CHUNK_BYTES (< 9 KB cap, assumption A-PROPS)
// and the number of keys is bounded by an explicit budget. Synchronous; fails closed.
import { utf8Bytes } from './digest.js';
import { KeyBudgetExceededError } from './errors.js';

export const CHUNK_BYTES = 8192;
export const DEFAULT_KEY_BUDGET = 100;

export interface PropertiesLike {
  getProperty(key: string): string | null;
  setProperty(key: string, value: string): unknown;
  deleteProperty(key: string): unknown;
  getKeys(): string[];
}

/** Split on UTF-8 byte size without cutting a code point. */
export function chunkByBytes(text: string, maxBytes: number = CHUNK_BYTES): string[] {
  const chunks: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of Array.from(text)) {
    const n = utf8Bytes(ch).length;
    if (size + n > maxBytes) {
      chunks.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  if (current.length > 0 || chunks.length === 0) chunks.push(current);
  return chunks;
}

export function createChunkedKv(store: PropertiesLike, keyBudget: number = DEFAULT_KEY_BUDGET) {
  const countKey = (name: string) => `${name}#n`;
  const chunkKey = (name: string, i: number) => `${name}#${i}`;
  return {
    put(name: string, value: string): void {
      const chunks = chunkByBytes(value);
      const own = this.keysOf(name);
      const total = store.getKeys().length - own.length + chunks.length + 1;
      if (total > keyBudget) throw new KeyBudgetExceededError(keyBudget);
      own.forEach((k) => store.deleteProperty(k));
      chunks.forEach((c, i) => store.setProperty(chunkKey(name, i), c));
      store.setProperty(countKey(name), String(chunks.length));
    },
    get(name: string): string | null {
      const raw = store.getProperty(countKey(name));
      if (raw === null) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1) return null;
      let out = '';
      for (let i = 0; i < n; i++) {
        const part = store.getProperty(chunkKey(name, i));
        if (part === null) return null; // torn write: fail closed
        out += part;
      }
      return out;
    },
    keysOf(name: string): string[] {
      const prefix = `${name}#`;
      return store.getKeys().filter((k) => k.indexOf(prefix) === 0 && /^\d+$|^n$/.test(k.slice(prefix.length)));
    },
  };
}
