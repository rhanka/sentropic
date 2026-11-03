// INTERNAL lane-call preparation helpers for the lane client engine (not
// packed): JS-API-use assertions, source-credential lease resolution and
// application. runtimeComposition.absent: missing provider / null lease →
// relay_auth_required; provider/apply failure → sanitized relay_grant_unavailable;
// foreign session → relay_scope_refused; expired lease → relay_grant_expired.
// RC0 inner routes carry source auth; additive mesh routes never call the
// provider (runtimeComposition.ownership).
import { relayError } from './registry-types.js';
import type { RelayError, SessionRef } from './registry-types.js';
import { jcsCanonicalize } from './relay-wire.js';
import type {
  SessionRelayConnectCallOptions,
  SessionRelaySourceCredentialLeaseV1,
  SessionRelaySourceCredentialsProviderV1,
} from './relay-types.js';
import type { SessionRelayLaneCallV1 } from './relay-lane-record.js';
import { isPlainObject } from './relay-lane-record.js';

export const RC0_PATH_PREFIX = '/api/v1/auth/';

export interface LaneClientEngineDepsV1 {
  readonly sessionRef: SessionRef;
  readonly sourceCredentials: SessionRelaySourceCredentialsProviderV1 | null;
  readonly transport: import('./relay-lane-record.js').SessionRelayLaneTransportV1;
  readonly now: () => number;
}

export function neverAbort(): AbortSignal {
  return new AbortController().signal;
}

export function assertParameters(parameters: unknown, method: string): asserts parameters is Record<string, unknown> {
  if (!isPlainObject(parameters)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: parameters must be a single named object`);
  }
}

export function assertOptions(options: unknown, method: string): asserts options is SessionRelayConnectCallOptions | undefined {
  if (options === undefined) return;
  if (!isPlainObject(options)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: options must be an object`);
  }
  if ('signal' in options && options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: options.signal must be an AbortSignal`);
  }
}

export async function resolveLease(
  deps: LaneClientEngineDepsV1,
  call: SessionRelayLaneCallV1,
  signal: AbortSignal | undefined,
): Promise<{ lease: SessionRelaySourceCredentialLeaseV1 } | { error: RelayError }> {
  const provider = deps.sourceCredentials;
  if (!provider) return { error: relayError('relay_auth_required') };
  let lease: SessionRelaySourceCredentialLeaseV1 | null = null;
  try {
    lease = await provider.resolve({
      sessionRef: deps.sessionRef,
      routeId: call.routeId,
      pathParameters: call.pathParameters,
      signal: signal ?? neverAbort(),
    });
  } catch {
    return { error: relayError('relay_grant_unavailable') };
  }
  if (!lease) return { error: relayError('relay_auth_required') };
  const wellFormed =
    isPlainObject(lease) && typeof lease.applyTo === 'function' && typeof lease.expiresAt === 'number' && lease.sessionRef !== undefined;
  if (!wellFormed) return { error: relayError('relay_grant_unavailable') };
  if (jcsCanonicalize(lease.sessionRef) !== jcsCanonicalize(deps.sessionRef)) return { error: relayError('relay_scope_refused') };
  if (deps.now() >= lease.expiresAt) return { error: relayError('relay_grant_expired') };
  return { lease };
}

// Apply the opaque lease to the mesh-internal sink once, immediately before
// send; header names/encoding come from the received RC0 capsule only.
// Provider/apply failure → null (caller maps to relay_grant_unavailable).
export function applyLease(lease: SessionRelaySourceCredentialLeaseV1): Record<string, string> | null {
  const headers: Record<string, string> = {};
  try {
    lease.applyTo({
      setSourceAuthHeader(name, value) {
        headers[name] = value;
      },
    });
  } catch {
    return null;
  }
  return headers;
}
