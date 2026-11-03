// L-2 composition contract (RC2.contract r3 §8 / runtimeComposition): what
// trusted host composition supplies vs what stays inside mesh. Any change to
// this split is a contract change, not an implementation detail. Host
// composition supplies ONLY the keys below; sockets, URLs, headers, keys, wire
// prefixes, grants and endpoint admissions are never caller arguments and are
// rejected here (invalid JS API use → TypeError at the port boundary).
import type { SessionRelayHostCompositionV1 } from './relay-types.js';

/** Keys trusted host composition may supply (exhaustive, exact-key checked). */
export const SESSION_RELAY_HOST_COMPOSITION_KEYS: readonly string[] = [
  'processBindingRef',
  'sourceCredentials',
  'now',
];

/** What stays inside mesh — never a host argument (see relay-wiring, internal). */
export const SESSION_RELAY_MESH_INTERNAL: readonly string[] = [
  'endpointRegistry',
  'installationSigner',
  'workloadSigner',
  'grantResolver',
  'tlsPins',
  'spkiPins',
  'socketFactory',
  'http2Factory',
  'url',
  'wirePrefix',
  'adjacentGrantRef',
  'endpointAdmissionRefs',
];

// validateHostComposition returns a defect string or null. Shape defects are
// reported to the port, which converts them to TypeError (invalid JS API use),
// never to a typed relay refusal.
export function validateHostComposition(composition: unknown): string | null {
  if (typeof composition !== 'object' || composition === null || Array.isArray(composition)) {
    return 'composition must be a single named object';
  }
  const keys = Object.keys(composition as Record<string, unknown>);
  for (const key of keys) {
    if (!SESSION_RELAY_HOST_COMPOSITION_KEYS.includes(key)) {
      return `unlisted composition key: ${key}`;
    }
  }
  for (const key of SESSION_RELAY_HOST_COMPOSITION_KEYS) {
    if (!keys.includes(key)) return `missing composition key: ${key}`;
  }
  const c = composition as Record<string, unknown>;
  const pbr = c.processBindingRef;
  if (typeof pbr !== 'object' || pbr === null
    || typeof (pbr as Record<string, unknown>).id !== 'string'
    || typeof (pbr as Record<string, unknown>).revision !== 'number'
    || typeof (pbr as Record<string, unknown>).digest !== 'string') {
    return 'processBindingRef must be { id: string, revision: number, digest: string }';
  }
  const sc = c.sourceCredentials;
  if (typeof sc !== 'object' || sc === null || typeof (sc as Record<string, unknown>).resolve !== 'function') {
    return 'sourceCredentials must be an immutable provider with resolve()';
  }
  if (typeof c.now !== 'function') return 'now must be a function';
  return null;
}

// splitComposition: the host-supplied half of a connect call. The mesh-internal
// half is only ever obtained from the registered wiring seam (relay-wiring),
// never from the caller.
export function hostSuppliedComposition(composition: SessionRelayHostCompositionV1): SessionRelayHostCompositionV1 {
  return {
    processBindingRef: composition.processBindingRef,
    sourceCredentials: composition.sourceCredentials,
    now: composition.now,
  };
}
