// RC2.contract r3 route matrix: the 28 closed inner routes (19 frozen RC0 +
// 9 additive mesh). relay-prepare / relay-upgrade (outer mounts) and the
// browser / policy routes stay inside mesh or the receiver and are NOT lane
// routeIds. Source: remote-session-contract-manifest.v1.json (r3, sha256
// 88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565) `routes`.
import type { RelayErrorCode } from './registry-types.js';

export type SessionRelayLane = 'content' | 'actions' | 'results' | 'lifecycle';
export type SessionRelayStage = 'listing' | 'bootstrap' | 'bound';
export type SessionRelayEngineKind = 'cli' | 'app-chat';

export interface SessionRelayRouteSpec {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  readonly lane: SessionRelayLane;
  readonly stages: readonly SessionRelayStage[];
  readonly engines: readonly SessionRelayEngineKind[];
  readonly stream: boolean;
  readonly maxRequestBytes: number;
  readonly successStatus: number;
  readonly pathParameters: readonly string[];
  readonly bodyRequired: boolean;
}

const R = '/api/v1/auth/session/content/:bindingId';
const S = `${R}/source/sessions/:sourceSessionId`;
const M = '/mesh/v1/remote-sessions/:sessionId';

export const SESSION_RELAY_INNER_ROUTES = {
  'source-open': { method: 'POST', path: `${R}/source/sessions`, lane: 'lifecycle', stages: ['bootstrap', 'bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId'], bodyRequired: true },
  'source-renew': { method: 'POST', path: `${S}/renew`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'grant-fetch': { method: 'GET', path: `${S}/grants/:proposalId`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId', 'proposalId'], bodyRequired: false },
  'policy-fetch': { method: 'GET', path: `${S}/policies/:policyId/:policyRevision`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId', 'policyId', 'policyRevision'], bodyRequired: false },
  'activation-ack': { method: 'POST', path: `${S}/acks`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'native-challenge': { method: 'POST', path: `${S}/challenges`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'source-control': { method: 'GET', path: `${S}/control`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: true, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: false },
  'cli-proof': { method: 'POST', path: `${S}/proofs`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'action-nonce': { method: 'POST', path: `${S}/actions/nonces`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'continuity-ack': { method: 'POST', path: `${R}/source/acks`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId'], bodyRequired: true },
  'history-auth': { method: 'GET', path: `${R}/history/authorizations/:authorizationId`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'authorizationId'], bodyRequired: false },
  'history-admission': { method: 'GET', path: `${R}/history/admissions/:descriptorHash`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'descriptorHash'], bodyRequired: false },
  'typed-events': { method: 'POST', path: `${S}/events`, lane: 'content', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: true },
  'pty-fragments': { method: 'POST', path: `${R}/fragments`, lane: 'content', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId'], bodyRequired: true },
  'archive-snapshot': { method: 'POST', path: `${R}/source/snapshots`, lane: 'content', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId'], bodyRequired: true },
  'archive-segment': { method: 'POST', path: `${R}/source/segments`, lane: 'content', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId'], bodyRequired: true },
  'action-stream': { method: 'GET', path: `${S}/actions/stream`, lane: 'actions', stages: ['bound'], engines: ['cli'], stream: true, maxRequestBytes: 0, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId'], bodyRequired: false },
  'action-claim': { method: 'POST', path: `${S}/actions/:actionId/claim`, lane: 'actions', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId', 'actionId'], bodyRequired: true },
  'action-result': { method: 'POST', path: `${S}/actions/:actionId/results`, lane: 'results', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['bindingId', 'sourceSessionId', 'actionId'], bodyRequired: true },
  'listing-grant-fetch': { method: 'GET', path: `${M}/listing-grants/:grantId`, lane: 'lifecycle', stages: ['listing', 'bootstrap', 'bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['sessionId', 'grantId'], bodyRequired: false },
  'listing-grant-ack': { method: 'POST', path: `${M}/listing-grants/:grantId/acks`, lane: 'lifecycle', stages: ['listing', 'bootstrap', 'bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId', 'grantId'], bodyRequired: true },
  'listing-publish': { method: 'POST', path: `${M}/listing`, lane: 'lifecycle', stages: ['listing', 'bootstrap', 'bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId'], bodyRequired: true },
  'freshness-publish': { method: 'POST', path: `${M}/freshness`, lane: 'lifecycle', stages: ['listing', 'bootstrap', 'bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId'], bodyRequired: true },
  'lifecycle-publish': { method: 'POST', path: `${M}/lifecycle`, lane: 'lifecycle', stages: ['bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId'], bodyRequired: true },
  'snapshot-publish': { method: 'POST', path: `${M}/snapshot`, lane: 'lifecycle', stages: ['bound'], engines: ['cli', 'app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId'], bodyRequired: true },
  'drive-binding-fetch': { method: 'GET', path: `${M}/drive-bindings/:bindingId/:consentRevision`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 0, successStatus: 200, pathParameters: ['sessionId', 'bindingId', 'consentRevision'], bodyRequired: false },
  'drive-binding-ack': { method: 'POST', path: `${M}/drive-bindings/:bindingId/:consentRevision/acks`, lane: 'lifecycle', stages: ['bound'], engines: ['cli'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId', 'bindingId', 'consentRevision'], bodyRequired: true },
  'chat-events': { method: 'POST', path: `${M}/chat/events`, lane: 'content', stages: ['bound'], engines: ['app-chat'], stream: false, maxRequestBytes: 65536, successStatus: 200, pathParameters: ['sessionId'], bodyRequired: true },
} as const satisfies Record<string, SessionRelayRouteSpec>;

export type SessionRelayLaneRequestRouteId = Exclude<keyof typeof SESSION_RELAY_INNER_ROUTES, 'source-control' | 'action-stream'>;
export type SessionRelayLaneStreamRouteId = 'source-control' | 'action-stream';
export type SessionRelayLaneRouteId = keyof typeof SESSION_RELAY_INNER_ROUTES;

export const SESSION_RELAY_LANE_REQUEST_ROUTE_IDS: readonly SessionRelayLaneRequestRouteId[] = (
  Object.keys(SESSION_RELAY_INNER_ROUTES) as SessionRelayLaneRouteId[]
).filter((id): id is SessionRelayLaneRequestRouteId => !SESSION_RELAY_INNER_ROUTES[id].stream);

export const SESSION_RELAY_LANE_STREAM_ROUTE_IDS: readonly SessionRelayLaneStreamRouteId[] = ['source-control', 'action-stream'];

type RevisionPathParameter = 'policyRevision' | 'consentRevision';

export type SessionRelayPathParameters<R extends SessionRelayLaneRouteId> = {
  [K in (typeof SESSION_RELAY_INNER_ROUTES)[R]['pathParameters'][number]]: K extends RevisionPathParameter ? number : string;
};

export type SessionRelayRequestBody<R extends SessionRelayLaneRouteId> =
  (typeof SESSION_RELAY_INNER_ROUTES)[R]['bodyRequired'] extends true ? unknown : null;

export function relayRouteSpec(routeId: string): SessionRelayRouteSpec | null {
  return (SESSION_RELAY_INNER_ROUTES as Record<string, SessionRelayRouteSpec>)[routeId] ?? null;
}

export const SESSION_RELAY_CLOSE_REASONS: readonly RelayErrorCode[] = [
  'relay_auth_required', 'relay_scope_refused', 'relay_consent_refused', 'relay_lane_refused',
  'relay_loop', 'relay_hop_limit', 'relay_route_conflict', 'relay_stale_generation',
  'relay_frame_conflict', 'relay_grant_expired', 'relay_grant_revoked', 'relay_grant_unavailable',
  'relay_origin_refused', 'relay_protocol_refused', 'relay_oversize', 'relay_version_unsupported',
  'relay_backpressure', 'relay_unavailable', 'relay_policy_unavailable',
];
