// PACKED public entry point for the RC2 relay-1 preparation ports
// (package.json exports "./sessions/relay"). Exposes only the contract surface:
// the port/parameter/result types, the route matrix, the shape validators, the
// connector factory and isSessionRelayLaneClient. The brand symbol and the
// mesh-wiring seam (relay-brand / relay-wiring) are intentionally NOT
// re-exported: consumers can never mint a branded client or inject sockets,
// URLs, grants, prefixes or keys.
//
// Fail-closed preparation state: DEP-FED is a source-gap, so no mesh wiring is
// registered in production and every connect resolves to the typed refusal
// relay_grant_unavailable — all live routes, including direct B→A, stay
// DISABLED. No local fill of any source-gap field.
import { relayError } from './registry-types.js';
import { validateConnectParameters } from './relay-validate.js';
import { currentSessionRelayMeshWiring } from './relay-wiring.js';
import { isSessionRelayLaneClient } from './relay-skeleton.js';
import { validateHostComposition } from './relay-composition.js';
import type {
  SessionRelayConnectCallOptions,
  SessionRelayConnectParametersV1,
  SessionRelayConnectResult,
  SessionRelayEndpointConnectorPortV1,
  SessionRelayHostCompositionV1,
} from './relay-types.js';

export type {
  SessionRelayConnectBindingRef,
  SessionRelayConnectCallOptions,
  SessionRelayConnectParametersV1,
  SessionRelayConnectResult,
  SessionRelayConnectResultV1,
  SessionRelayEndpointConnectorPortV1,
  SessionRelayErrorV1,
  SessionRelayHostCompositionV1,
  SessionRelayLaneClientV1,
  SessionRelayLaneCloseParametersV1,
  SessionRelayLaneCloseResultV1,
  SessionRelayLaneRequestParametersV1,
  SessionRelayLaneResponseV1,
  SessionRelayLaneStreamParametersV1,
  SessionRelaySourceCredentialLeaseV1,
  SessionRelaySourceCredentialsProviderV1,
} from './relay-types.js';
export {
  SESSION_RELAY_INNER_ROUTES,
  SESSION_RELAY_LANE_REQUEST_ROUTE_IDS,
  SESSION_RELAY_LANE_STREAM_ROUTE_IDS,
  SESSION_RELAY_CLOSE_REASONS,
  relayRouteSpec,
} from './relay-routes.js';
export type {
  SessionRelayLane,
  SessionRelayLaneRequestRouteId,
  SessionRelayLaneRouteId,
  SessionRelayLaneStreamRouteId,
  SessionRelayPathParameters,
  SessionRelayRequestBody,
  SessionRelayRouteSpec,
  SessionRelayStage,
  SessionRelayEngineKind,
} from './relay-routes.js';
export {
  validateConnectParameters,
  validateLaneCloseParameters,
  validateLaneRequestParameters,
  validateLaneStreamParameters,
} from './relay-validate.js';
export { isSessionRelayLaneClient };
// L-5 capsule runtime pins (packed for the h2a capsule lock + vector parity).
export {
  RELAY_CAPSULE_LIMITS,
  RELAY_CAPSULE_NODE_PINS,
  RELAY_INNER_H2_CLIENT_SETTINGS_PIN,
  RELAY_INNER_TLS_CLIENT_PIN,
  RELAY_INNER_TLS_SERVER_PIN,
  capsuleRuntimePin,
} from './relay-capsule.js';
export type { CapsuleRuntimePin, RelayCapsuleNodePin } from './relay-capsule.js';

function assertParameters(parameters: unknown): asserts parameters is Record<string, unknown> {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new TypeError('SessionRelayEndpointConnectorPortV1.connect: parameters must be a single named object');
  }
}

function assertOptions(options: unknown): asserts options is SessionRelayConnectCallOptions | undefined {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('SessionRelayEndpointConnectorPortV1.connect: options must be an object');
  }
  if ('signal' in options && options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError('SessionRelayEndpointConnectorPortV1.connect: options.signal must be an AbortSignal');
  }
}

// Trusted host composition supplies the native-host capability/process binding
// and the immutable source-credentials provider; everything wire-related stays
// inside mesh (see relay-wiring, internal). The caller cannot supply sockets,
// URLs, grants, prefixes or keys.
export function createSessionRelayEndpointConnectorPort(
  composition: SessionRelayHostCompositionV1,
): SessionRelayEndpointConnectorPortV1 {
  const compositionDefect = validateHostComposition(composition);
  if (compositionDefect) {
    // L-2: host composition supplies only processBindingRef / sourceCredentials /
    // now; sockets, URLs, headers, keys, wire prefixes and grants are invalid JS
    // API use here → TypeError, never a typed relay refusal.
    throw new TypeError(`createSessionRelayEndpointConnectorPort: ${compositionDefect}`);
  }
  return {
    async connect(parameters, options) {
      assertParameters(parameters);
      assertOptions(options);
      if (options?.signal?.aborted) {
        return { status: 'refused', error: relayError('relay_unavailable', true) };
      }
      const defect = validateConnectParameters(parameters);
      if (defect) {
        return { status: 'refused', error: relayError('relay_protocol_refused') };
      }
      const wiring = currentSessionRelayMeshWiring();
      if (!wiring) {
        // DEP-FED source-gap: no grant resolution, no endpoint admission —
        // fail closed, no local fill, live routes stay disabled.
        return { status: 'refused', error: relayError('relay_grant_unavailable') };
      }
      return wiring.connect(parameters as SessionRelayConnectParametersV1, options?.signal) as Promise<SessionRelayConnectResult>;
    },
  };
}
