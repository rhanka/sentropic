// CHAIN-BIND reference evaluators (RC2.contract r3, vectors/state-transitions.json
// family CHAIN-BIND) plus the pinned inner-TLS bind context. Pure functions.
import { createHash } from 'node:crypto';
import { jcsCanonicalize } from './relay-wire.js';

export const RELAY_INNER_ALPN = 'cluster-mesh.session-relay.inner.v1';
export const RELAY_TLS_EXPORTER_LABEL = 'EXPORTER-cluster-mesh-session-relay-v1';
export const RELAY_TLS_EXPORTER_BYTES = 32;
export const RELAY_BIND_MIN_BYTES = 1;
export const RELAY_BIND_MAX_BYTES = 8192;

export type BindDecision = 'allow-model' | 'close-before-handler';

export interface BindGuardInput {
  readonly alpn: string;
  readonly spkiMatches: boolean;
  readonly signerRoleMatches: boolean;
  readonly signatureValid: boolean;
  readonly exporterMatches: boolean;
  readonly coordinatesMatch: boolean;
  readonly earlyHttp2: boolean;
  readonly secondBind: boolean;
  readonly strictUtf8: boolean;
  readonly jcs: boolean;
  readonly duplicateKeys: boolean;
  readonly unknownKeys: boolean;
  readonly length: number;
  readonly bodyLength: number;
}

// bindGuard: the inner TLS leg is accepted only with the pinned ALPN, matching
// SPKI pins and installation role, a valid Bind signature, the exporter-derived
// context, matching circuit coordinates, no early HTTP/2, no second Bind, strict
// UTF-8, JCS encoding, no duplicate or unknown keys, and a 4-byte-length-prefixed
// body of 1..8192 bytes whose declared length equals the actual body length.
export function chainBindGuard(input: BindGuardInput): BindDecision {
  if (input.alpn !== RELAY_INNER_ALPN) return 'close-before-handler';
  if (!input.spkiMatches || !input.signerRoleMatches || !input.signatureValid) return 'close-before-handler';
  if (!input.exporterMatches || !input.coordinatesMatch) return 'close-before-handler';
  if (input.earlyHttp2 || input.secondBind) return 'close-before-handler';
  if (!input.strictUtf8 || !input.jcs || input.duplicateKeys || input.unknownKeys) return 'close-before-handler';
  if (input.length < RELAY_BIND_MIN_BYTES || input.length > RELAY_BIND_MAX_BYTES) return 'close-before-handler';
  if (input.length !== input.bodyLength) return 'close-before-handler';
  return 'allow-model';
}

export const RELAY_BIND_SERVER_CONSTRUCTION = 'non-listening-tls-createServer-emit-connection-secureConnection';
export const RELAY_BIND_CLIENT_CONSTRUCTION = 'tls-connect-over-circuit-then-h2-createConnection-same-socket';

// Canonical event order for the exact Node construction: Opened, inner TLS
// handshake (tls-complete), exporter derivation, Bind read+verify, B writes
// Bind, drains, receives Bound, hands the same socket to HTTP/2; then the
// mirror image on A, first handler, clean end.
export const RELAY_BIND_EVENT_ORDER: readonly string[] = [
  'opened', 'tls-complete', 'exporter', 'bind-read-verified',
  'B-bind-write-callback', 'B-bind-drain', 'bound-received', 'B-h2-handoff',
  'A-bound-write-callback', 'A-bound-drain', 'A-h2-handoff',
  'first-handler', 'response-clean-end',
];

export interface SocketConstructionInput {
  readonly serverConstruction: string;
  readonly clientConstruction: string;
  readonly alpn: string;
  readonly contextBytes: number;
  readonly secondTls: boolean;
  readonly sessionReused: boolean;
  readonly events: readonly string[];
}

// socketConstruction: only the exact Node construction is accepted —
// tls.connect({socket}) on the client, a non-listening tls.createServer that
// emits "connection" on the server, then http2.connect/h2Server.emit("connection")
// over the same bound socket, 32-byte exporter context, no second TLS layer, no
// session resumption, and the canonical event order.
export function chainSocketConstruction(input: SocketConstructionInput): BindDecision {
  if (input.serverConstruction !== RELAY_BIND_SERVER_CONSTRUCTION) return 'close-before-handler';
  if (input.clientConstruction !== RELAY_BIND_CLIENT_CONSTRUCTION) return 'close-before-handler';
  if (input.alpn !== RELAY_INNER_ALPN) return 'close-before-handler';
  if (input.contextBytes !== RELAY_TLS_EXPORTER_BYTES) return 'close-before-handler';
  if (input.secondTls || input.sessionReused) return 'close-before-handler';
  if (input.events.length !== RELAY_BIND_EVENT_ORDER.length) return 'close-before-handler';
  for (let i = 0; i < RELAY_BIND_EVENT_ORDER.length; i += 1) {
    if (input.events[i] !== RELAY_BIND_EVENT_ORDER[i]) return 'close-before-handler';
  }
  return 'allow-model';
}

// Bind context: raw SHA-256 (32 bytes) of the JCS-canonicalized Bind body minus
// the tlsExporter / issuer / kid fields.
export function relayBindContextSha256(bindBody: Record<string, unknown>): Uint8Array {
  const { tlsExporter: _tlsExporter, issuer: _issuer, kid: _kid, ...rest } = bindBody;
  return new Uint8Array(createHash('sha256').update(jcsCanonicalize(rest), 'utf8').digest());
}
