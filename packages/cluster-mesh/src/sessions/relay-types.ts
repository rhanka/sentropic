// RC2.contract r3 §8 packed port types: SessionRelayEndpointConnectorPortV1 and
// the branded SessionRelayLaneClientV1 (manifest ports, signatures and
// runtimeComposition). The brand is module-private on purpose: a clientRef
// string can never instantiate a client; only trusted host composition inside
// mesh can mint one.
import type { RelayError, RevisionRef, SessionRef } from './registry-types.js';
import { SESSION_RELAY_LANE_CLIENT_BRAND } from './relay-brand.js';
import type {
  SessionRelayLane,
  SessionRelayLaneRequestRouteId,
  SessionRelayLaneStreamRouteId,
  SessionRelayPathParameters,
  SessionRelayRequestBody,
  SessionRelayStage,
} from './relay-routes.js';

export type SessionRelayErrorV1 = RelayError;

export type SessionRelayConnectBindingRef =
  | { readonly kind: 'listing'; readonly listingGrantRef: RevisionRef }
  | { readonly kind: 'bootstrap'; readonly approvedRegistrationRef: RevisionRef }
  | { readonly kind: 'cli'; readonly targetDigest: string; readonly admissionRef: RevisionRef }
  | { readonly kind: 'app-chat'; readonly chatBindingRef: RevisionRef };

export interface SessionRelayConnectParametersV1 {
  readonly sessionRef: SessionRef;
  readonly approvedRouteRef: RevisionRef;
  readonly stage: SessionRelayStage;
  readonly laneSet: readonly SessionRelayLane[];
  readonly bindingRef: SessionRelayConnectBindingRef;
}

export interface SessionRelayConnectCallOptions {
  readonly signal?: AbortSignal;
}

export type SessionRelayConnectResultV1 =
  | {
      readonly status: 'connected';
      readonly clientRef: string;
      readonly sessionRef: SessionRef;
      readonly stage: SessionRelayStage;
      readonly lanes: readonly SessionRelayLane[];
      readonly descriptorDigest: string;
    }
  | { readonly status: 'refused'; readonly error: SessionRelayErrorV1 };

export interface SessionRelayLaneRequestParametersV1<R extends SessionRelayLaneRequestRouteId = SessionRelayLaneRequestRouteId> {
  readonly routeId: R;
  readonly pathParameters: SessionRelayPathParameters<R>;
  readonly body: SessionRelayRequestBody<R>;
}

export interface SessionRelayLaneStreamParametersV1<R extends SessionRelayLaneStreamRouteId = SessionRelayLaneStreamRouteId> {
  readonly routeId: R;
  readonly pathParameters: SessionRelayPathParameters<R>;
  readonly body: SessionRelayRequestBody<R>;
}

export type SessionRelayLaneResponseV1 =
  | { readonly routeId: string; readonly response: unknown }
  | { readonly routeId: string; readonly error: SessionRelayErrorV1 }
  | { readonly routeId: string; readonly endpointRefusal: unknown };

export interface SessionRelayLaneCloseParametersV1 {
  readonly reason: SessionRelayErrorV1['code'];
}

export interface SessionRelayLaneCloseResultV1 {
  readonly status: 'closed';
}

export interface SessionRelayLaneClientV1 {
  readonly [SESSION_RELAY_LANE_CLIENT_BRAND]: 'SessionRelayLaneClientV1';
  request(
    parameters: SessionRelayLaneRequestParametersV1,
    options?: SessionRelayConnectCallOptions,
  ): Promise<SessionRelayLaneResponseV1>;
  stream(
    parameters: SessionRelayLaneStreamParametersV1,
    options?: SessionRelayConnectCallOptions,
  ): AsyncIterableIterator<SessionRelayLaneResponseV1>;
  close(parameters: SessionRelayLaneCloseParametersV1): Promise<SessionRelayLaneCloseResultV1>;
}

export type SessionRelayConnectResult = Extract<SessionRelayConnectResultV1, { status: 'refused' }> |
  (Extract<SessionRelayConnectResultV1, { status: 'connected' }> & { readonly client: SessionRelayLaneClientV1 });

export interface SessionRelayEndpointConnectorPortV1 {
  connect(
    parameters: SessionRelayConnectParametersV1,
    options?: SessionRelayConnectCallOptions,
  ): Promise<SessionRelayConnectResult>;
}

// What trusted HOST composition supplies at connector construction (contract
// runtimeComposition.sourceCredentials + §8): the authenticated native-host
// capability/process binding and the immutable source-credentials provider.
// Everything else (installation/workload signers, endpoint registry, TLS/SPKI
// pins, grant resolution, sockets, URLs, wire prefixes) stays inside mesh and
// is never a caller argument.
export interface SessionRelaySourceCredentialLeaseV1 {
  readonly sessionRef: SessionRef;
  readonly targetDigest: string | null;
  readonly expiresAt: number;
  applyTo(sink: { setSourceAuthHeader(name: string, value: string): void }): void;
}

export interface SessionRelaySourceCredentialsProviderV1 {
  resolve(context: {
    sessionRef: SessionRef;
    routeId: string;
    pathParameters: Record<string, string | number>;
    signal: AbortSignal;
  }): Promise<SessionRelaySourceCredentialLeaseV1 | null>;
}

export interface SessionRelayHostCompositionV1 {
  readonly processBindingRef: { readonly id: string; readonly revision: number; readonly digest: string };
  readonly sourceCredentials: SessionRelaySourceCredentialsProviderV1;
  readonly now: () => number;
}
