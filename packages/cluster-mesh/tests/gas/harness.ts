// GAS service mocks. No UrlFetchApp mock on purpose: any call is a ReferenceError.
import { createHash } from 'node:crypto';
import vm from 'node:vm';

export function mockUtilities() {
  return {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    computeDigest(_alg: unknown, value: unknown): number[] {
      if (!Array.isArray(value)) throw new TypeError('string overload is never used');
      const buf = Buffer.from(value.map((b: number) => b & 0xff));
      return Array.from(createHash('sha256').update(buf).digest(), (b) => (b > 127 ? b - 256 : b));
    },
  };
}

export function mockProperties(opts: { maxValueBytes?: number } = {}) {
  const map = new Map<string, string>();
  const max = opts.maxValueBytes ?? 9 * 1024;
  return {
    map,
    getProperty: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setProperty(k: string, v: string) {
      if (Buffer.byteLength(v) > max) throw new Error('value too large');
      map.set(k, v);
    },
    deleteProperty: (k: string) => void map.delete(k),
    getKeys: () => Array.from(map.keys()),
  };
}

export function mockLock(available = true) {
  const state = { held: false, releases: 0 };
  return {
    state,
    service: {
      getScriptLock: () => ({
        tryLock: () => ((state.held = available), available),
        releaseLock: () => ((state.held = false), state.releases++),
      }),
    },
  };
}

/** Runs bundle code in a context stripped of Promise/TextEncoder/crypto/URL/timers and with only mocked GAS globals. */
export function loadBundle(code: string, globals: Record<string, unknown>) {
  const ctx = vm.createContext({ ...globals });
  vm.runInContext(
    'delete globalThis.Promise; delete globalThis.TextEncoder; delete globalThis.crypto; delete globalThis.URL;' +
      'delete globalThis.queueMicrotask; delete globalThis.setTimeout; delete globalThis.WebAssembly;',
    ctx,
  );
  vm.runInContext(code, ctx);
  return { ctx, api: vm.runInContext('SentropicClusterMesh', ctx) as any };
}
