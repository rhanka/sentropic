// L-5 capsule runtime pins — PACKED (re-exported from ./sessions/relay): h2a
// needs them for the capsule lock and for node-socket-constructions vector
// parity; h2a constructs no TLS itself. CHAIN-BIND receipts exist for Node
// v22.22.1 / v24.18.0 (checks/*.json, sha256 pinned below from RC2.contract r3,
// MANIFEST.sha256 6245d3ae…). The capsule runtime is NAMED at runtime
// (capsuleRuntimePin) so h2a can assert host parity when it differs.
// TLS 1.3 only, no 0-RTT, no resumption; HTTP/2 client SETTINGS pinned.
import {
  RELAY_BIND_MAX_BYTES,
  RELAY_BIND_MIN_BYTES,
  RELAY_INNER_ALPN,
  RELAY_TLS_EXPORTER_BYTES,
  RELAY_TLS_EXPORTER_LABEL,
} from './relay-bind.js';
import { RELAY_LINK_MAX_FRAMES, RELAY_LINK_MAX_PAYLOAD_BYTES } from './relay-credit.js';
import { RELAY_DATA_MAX_DECODED, RELAY_DATA_MAX_ENCODED } from './relay-frames.js';
import { RELAY_RECORD_MAX_BYTES } from './relay-wire.js';

export const RELAY_CAPSULE_NODE_PINS = {
  'v22.22.1': {
    checksFile: 'checks/node-22.22.1.json',
    sha256: 'cbaa3f54562b644a149e0fa35561680ade4d8c98da57c7ba48b47bd4968f90ae',
  },
  'v24.18.0': {
    checksFile: 'checks/node-24.18.0.json',
    sha256: '631545808bac67c980166ee86ca949de9e0b1e8472346122fbc8e6d2052ca7f1',
  },
} as const;

export type RelayCapsuleNodePin = (typeof RELAY_CAPSULE_NODE_PINS)[keyof typeof RELAY_CAPSULE_NODE_PINS];

export interface CapsuleRuntimePin {
  readonly node: string;
  readonly openssl: string;
  readonly pinned: boolean;
  readonly checksSha256: string | null;
}

// Name the capsule runtime so h2a can assert host parity; pinned=true only for
// the receipt-backed Node versions above.
export function capsuleRuntimePin(): CapsuleRuntimePin {
  const node = process.version;
  const pin = (RELAY_CAPSULE_NODE_PINS as Record<string, RelayCapsuleNodePin>)[node];
  return {
    node,
    openssl: process.versions.openssl,
    pinned: Boolean(pin),
    checksSha256: pin?.sha256 ?? null,
  };
}

// Exact pinned TLS option objects for the inner lane connection. TLS 1.3 only
// (min=max), ALPN exactly the inner label; no 0-RTT (maxEarlyDataSize: 0); no
// resumption — the client never supplies/caches a session and the server runs
// a no-ticket context (isSessionReused() must stay false, see the
// socketConstruction vector).
export const RELAY_INNER_TLS_CLIENT_PIN = {
  ALPNProtocols: [RELAY_INNER_ALPN],
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
  maxEarlyDataSize: 0,
  rejectUnauthorized: true,
} as const;

export const RELAY_INNER_TLS_SERVER_PIN = {
  ALPNProtocols: [RELAY_INNER_ALPN],
  minVersion: 'TLSv1.3',
  maxVersion: 'TLSv1.3',
  sessionTickets: false,
} as const;

// Exact pinned HTTP/2 client SETTINGS for the inner lane stream.
export const RELAY_INNER_H2_CLIENT_SETTINGS_PIN = {
  enablePush: false,
  enableConnectProtocol: false,
  maxConcurrentStreams: 8,
  maxHeaderListSize: 8192,
} as const;

// Aggregate of every frozen numeric/label cap the capsule lock joins.
export const RELAY_CAPSULE_LIMITS = {
  alpn: RELAY_INNER_ALPN,
  tlsExporterLabel: RELAY_TLS_EXPORTER_LABEL,
  tlsExporterContextBytes: RELAY_TLS_EXPORTER_BYTES,
  queueMaxEvents: RELAY_LINK_MAX_FRAMES,
  queueMaxEncodedBytes: RELAY_LINK_MAX_PAYLOAD_BYTES,
  dataMaxEncoded: RELAY_DATA_MAX_ENCODED,
  dataMaxDecoded: RELAY_DATA_MAX_DECODED,
  recordMaxBytes: RELAY_RECORD_MAX_BYTES,
  bindMinBytes: RELAY_BIND_MIN_BYTES,
  bindMaxBytes: RELAY_BIND_MAX_BYTES,
} as const;
