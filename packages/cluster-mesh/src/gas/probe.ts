// Fail-closed startup probe: every conservative assumption (g0 ASSUMPTIONS.md) is checked against the live runtime.
// probe() never throws; it returns typed errors. init() throws GasProbeFailedError if any error is returned.
import { createGasDigest, type GasUtilities } from './digest.js';
import { CHUNK_BYTES, type PropertiesLike } from './props.js';
import { GasProbeFailedError, type GasProbeError } from './errors.js';
import type { LockServiceLike } from './lock.js';

export interface GasEnv {
  readonly Utilities?: GasUtilities;
  readonly PropertiesService?: { getScriptProperties(): PropertiesLike };
  readonly LockService?: LockServiceLike;
}
export interface ProbeOptions {
  /** 'registry' (S1, mode b): digest only. 'store' (mode a): also Properties chunk + lock, with throwaway keys. */
  readonly mode: 'registry' | 'store';
}
export interface ProbeResult {
  readonly ok: boolean;
  readonly errors: readonly GasProbeError[];
}

const VECTORS: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0x61, 0x62, 0x63], 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [[0xc3, 0xa9], '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c'],
  [[0xf0, 0x9f, 0x98, 0x80], 'f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9'],
  [[], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
];

function msg(e: unknown): string {
  return String(e).slice(0, 160);
}

export function probe(env: GasEnv, options: ProbeOptions): ProbeResult {
  const errors: GasProbeError[] = [];
  if (!env.Utilities || typeof env.Utilities.computeDigest !== 'function') {
    errors.push({ code: 'probe_digest_unavailable', detail: 'Utilities.computeDigest missing' });
  } else {
    try {
      const digest = createGasDigest(env.Utilities);
      for (const [bytes, expected] of VECTORS) {
        const got = digest.sha256Bytes(bytes);
        if (got !== expected) {
          errors.push({ code: 'probe_digest_mismatch', detail: `${bytes.length}B -> ${got}` });
          break;
        }
      }
    } catch (e) {
      errors.push({ code: 'probe_digest_unavailable', detail: msg(e) });
    }
  }
  if (options.mode === 'store') {
    if (!env.PropertiesService) {
      errors.push({ code: 'probe_props_unavailable', detail: 'PropertiesService missing' });
    } else {
      const key = 'probe:chunk';
      try {
        const props = env.PropertiesService.getScriptProperties();
        const value = new Array(CHUNK_BYTES + 1).join('x');
        props.setProperty(key, value);
        if (props.getProperty(key) !== value) errors.push({ code: 'probe_props_chunk', detail: 'roundtrip mismatch' });
        props.deleteProperty(key);
      } catch (e) {
        errors.push({ code: 'probe_props_chunk', detail: msg(e) });
      }
    }
    try {
      const lock = env.LockService ? env.LockService.getScriptLock() : null;
      if (!lock || !lock.tryLock(1000)) errors.push({ code: 'probe_lock_unavailable', detail: 'tryLock failed' });
      else lock.releaseLock();
    } catch (e) {
      errors.push({ code: 'probe_lock_unavailable', detail: msg(e) });
    }
  }
  return { ok: errors.length === 0, errors };
}

/** Startup gate: fail closed. Returns the digest adapter only if the runtime passed every probe. */
export function init(env: GasEnv, options: ProbeOptions) {
  const result = probe(env, options);
  if (!result.ok) throw new GasProbeFailedError(result.errors);
  return { digest: createGasDigest(env.Utilities as GasUtilities) };
}
