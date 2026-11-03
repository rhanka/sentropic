// L-5 capsule runtime pins: asserts the packed pin objects against the frozen
// contract values (RC2.contract r3, MANIFEST.sha256 6245d3ae…) — Node
// v22.22.1 / v24.18.0 CHAIN-BIND receipts with their checks/*.json sha256, ALPN
// `cluster-mesh.session-relay.inner.v1`, TLS 1.3 only / no 0-RTT / no
// resumption, HTTP/2 client SETTINGS (enablePush:false, enableConnectProtocol:
// false, max 8 streams, header list ≤ 8192) and the aggregate cap table.
import { describe, expect, it } from 'vitest';
import {
  RELAY_CAPSULE_LIMITS,
  RELAY_CAPSULE_NODE_PINS,
  RELAY_INNER_H2_CLIENT_SETTINGS_PIN,
  RELAY_INNER_TLS_CLIENT_PIN,
  RELAY_INNER_TLS_SERVER_PIN,
  capsuleRuntimePin,
} from '../../src/sessions/relay.js';
import { RELAY_INNER_ALPN } from '../../src/sessions/relay-bind.js';

describe('RC2 relay-1 L-5: capsule runtime pins', () => {
  it('pins the receipt-backed Node versions with their checks/*.json sha256', () => {
    expect(Object.keys(RELAY_CAPSULE_NODE_PINS).sort()).toEqual(['v22.22.1', 'v24.18.0']);
    expect(RELAY_CAPSULE_NODE_PINS['v22.22.1']).toEqual({
      checksFile: 'checks/node-22.22.1.json',
      sha256: 'cbaa3f54562b644a149e0fa35561680ade4d8c98da57c7ba48b47bd4968f90ae',
    });
    expect(RELAY_CAPSULE_NODE_PINS['v24.18.0']).toEqual({
      checksFile: 'checks/node-24.18.0.json',
      sha256: '631545808bac67c980166ee86ca949de9e0b1e8472346122fbc8e6d2052ca7f1',
    });
  });

  it('names the capsule runtime (Node + OpenSSL) so h2a can assert host parity', () => {
    const pin = capsuleRuntimePin();
    expect(pin.node).toBe(process.version);
    expect(pin.openssl).toBe(process.versions.openssl);
    const expected = (RELAY_CAPSULE_NODE_PINS as Record<string, { sha256: string }>)[process.version];
    expect(pin.pinned).toBe(Boolean(expected));
    expect(pin.checksSha256).toBe(expected ? expected.sha256 : null);
  });

  it('pins TLS 1.3 only, exact inner ALPN, no 0-RTT, no resumption', () => {
    expect(RELAY_INNER_ALPN).toBe('cluster-mesh.session-relay.inner.v1');
    for (const pin of [RELAY_INNER_TLS_CLIENT_PIN, RELAY_INNER_TLS_SERVER_PIN]) {
      expect(pin.ALPNProtocols).toEqual(['cluster-mesh.session-relay.inner.v1']);
      expect(pin.minVersion).toBe('TLSv1.3');
      expect(pin.maxVersion).toBe('TLSv1.3');
    }
    expect(RELAY_INNER_TLS_CLIENT_PIN.maxEarlyDataSize).toBe(0); // no 0-RTT
    expect(RELAY_INNER_TLS_CLIENT_PIN).not.toHaveProperty('session'); // no client session cache
    expect(RELAY_INNER_TLS_SERVER_PIN.sessionTickets).toBe(false); // no-ticket context
  });

  it('pins the HTTP/2 client SETTINGS: enablePush:false, no CONNECT, ≤ 8 streams, header list ≤ 8192', () => {
    expect(RELAY_INNER_H2_CLIENT_SETTINGS_PIN).toEqual({
      enablePush: false,
      enableConnectProtocol: false,
      maxConcurrentStreams: 8,
      maxHeaderListSize: 8192,
    });
  });

  it('aggregates every frozen cap in one capsule table', () => {
    expect(RELAY_CAPSULE_LIMITS).toEqual({
      alpn: 'cluster-mesh.session-relay.inner.v1',
      tlsExporterLabel: 'EXPORTER-cluster-mesh-session-relay-v1',
      tlsExporterContextBytes: 32,
      queueMaxEvents: 8,
      queueMaxEncodedBytes: 131072,
      dataMaxEncoded: 24576,
      dataMaxDecoded: 16384,
      recordMaxBytes: 8192,
      bindMinBytes: 1,
      bindMaxBytes: 8192,
    });
  });
});
