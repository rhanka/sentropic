import { describe, expect, it } from 'vitest';
import { chainBindGuard, chainSocketConstruction, relayBindContextSha256, RELAY_BIND_EVENT_ORDER, RELAY_INNER_ALPN, RELAY_TLS_EXPORTER_LABEL } from '../../src/sessions/relay-bind.js';
import { chainFrameCheck, chainOpenPair, chainPathCheck } from '../../src/sessions/relay-chain.js';
import { chainPairFailure } from '../../src/sessions/relay-chain-failure.js';
import { chainCreditCheck, chainCreditTransfer } from '../../src/sessions/relay-credit.js';
import { chainTranslateFrames } from '../../src/sessions/relay-frames.js';
import { decodeRelayRecord, encodeRelayRecord, jcsCanonicalize, RELAY_RECORD_MAX_BYTES } from '../../src/sessions/relay-wire.js';
import { BIND_GUARD_CASES, SOCKET_CONSTRUCTION_CASES } from './relay-vectors-bind.js';
import { CREDIT_CHECK_CASES, CREDIT_TRANSFER_CASES, TRANSLATION_CASES } from './relay-vectors-frames.js';
import { FRAME_CHECK_CASES, OPEN_PAIR_CASES, PAIR_FAILURE_CASES, PATH_CHECK_CASES } from './relay-vectors-establish.js';
import { WIRE_RECORDS } from './relay-vectors-wire.js';

// r3 vector file pins (authoring-time sha256; the manifest pins
// vectors/state-transitions.json under referenceModelVectors).
const STATE_TRANSITIONS_SHA256 = '3e3e4acc27f6e7615c22dc08fabd75bcdb5339097104e0487e384d6ebbd4f018';
const CHAIN_WIRE_SHA256 = 'fbf667cc2679427003ecc834c87fa1ddc48bdfef445cdd288324bff09103ac23';

describe('RC2 relay-1 L-4: vector file pins', () => {
  it('pins the r3 state-transitions and chain-wire-coordinates digests', () => {
    expect(STATE_TRANSITIONS_SHA256).toBe('3e3e4acc27f6e7615c22dc08fabd75bcdb5339097104e0487e384d6ebbd4f018');
    expect(CHAIN_WIRE_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(PATH_CHECK_CASES.length).toBe(11);
    expect(OPEN_PAIR_CASES.length).toBe(17);
    expect(PAIR_FAILURE_CASES.length).toBe(15);
    expect(TRANSLATION_CASES.length + CREDIT_CHECK_CASES.length + CREDIT_TRANSFER_CASES.length).toBe(23);
    expect(BIND_GUARD_CASES.length + SOCKET_CONSTRUCTION_CASES.length).toBe(32);
    expect(WIRE_RECORDS.length).toBe(22);
  });
});

describe('CHAIN-ESTABLISH-2 golden vectors', () => {
  it('pathCheck: all 11 cases', () => {
    for (const c of PATH_CHECK_CASES) expect(chainPathCheck(c.input), c.id).toBe(c.expected);
  });
  it('frameCheck: data before opened', () => {
    for (const c of FRAME_CHECK_CASES) expect(chainFrameCheck(c.input), c.id).toBe(c.expected);
  });
  it('openPair: all 17 cases', () => {
    for (const c of OPEN_PAIR_CASES) expect(chainOpenPair(c.input), c.id).toBe(c.expected);
  });
  it('pairFailure: all 15 cases', () => {
    for (const c of PAIR_FAILURE_CASES) expect(chainPairFailure(c.input), c.id).toBe(c.expected);
  });
});

describe('CHAIN-FRAME-TRANSLATION golden vectors', () => {
  it('translation: re-framing keeps the byte stream and digest', () => {
    for (const c of TRANSLATION_CASES) {
      const result = chainTranslateFrames(c.input);
      if (typeof c.expected === 'string') expect(result.decision, c.id).toBe(c.expected);
      else expect(result, c.id).toEqual(c.expected);
    }
  });
  it('creditCheck: all 9 cases', () => {
    for (const c of CREDIT_CHECK_CASES) expect(chainCreditCheck(c.input.credit, c.input.state), c.id).toBe(c.expected);
  });
  it('creditTransfer: all 8 cases', () => {
    for (const c of CREDIT_TRANSFER_CASES) expect(chainCreditTransfer(c.input), c.id).toBe(c.expected);
  });
});

describe('CHAIN-BIND golden vectors', () => {
  it('bindGuard: all 18 cases', () => {
    for (const c of BIND_GUARD_CASES) expect(chainBindGuard(c.input), c.id).toBe(c.expected);
  });
  it('socketConstruction: all 14 cases', () => {
    for (const c of SOCKET_CONSTRUCTION_CASES) expect(chainSocketConstruction(c.input), c.id).toBe(c.expected);
  });
});

describe('chain-wire-coordinates: per-link re-framing', () => {
  const data = WIRE_RECORDS.filter((r) => r.schema === 'SessionRelayDataV1').map((r) => r.value);
  it('re-frames each direction onto the next link with restarted counters and identical bytes', () => {
    for (const direction of ['B-to-A', 'A-to-B']) {
      const legs = [1, 2].map((gen) => data.filter((f) => f.direction === direction && f.linkGeneration === gen));
      expect(legs[0].length).toBeGreaterThan(0);
      expect(legs[1].length).toBeGreaterThan(0);
      expect(legs[0][0].tunnelId).not.toBe(legs[1][0].tunnelId);
      expect(legs[0].every((f) => f.frameSequence === legs[0].indexOf(f) + 1)).toBe(true);
      expect(legs[1][0].frameSequence).toBe(1);
      expect(legs[1][0].byteOffset).toBe(0);
      const result = chainTranslateFrames({ incoming: legs[0], outgoing: legs[1] });
      expect(result.decision).toBe('allow');
      expect(result.incomingFrames).toBe(legs[0].length);
      expect(result.outgoingFrames).toBe(legs[1].length);
      expect(result.byteLength).toBe(legs[0].reduce((n, f) => n + f.byteLength, 0));
    }
  });
});

describe('wire framing + bind context', () => {
  it('encodes records as 4-byte BE length + JCS and decodes them back', () => {
    const record = { kind: 'open', b: 2, a: 1 };
    const encoded = encodeRelayRecord(record);
    expect(encoded.length).toBe(4 + new TextEncoder().encode(jcsCanonicalize(record)).length);
    expect(new DataView(encoded.buffer).getUint32(0)).toBe(encoded.length - 4);
    const decoded = decodeRelayRecord(encoded);
    expect(decoded.record).toEqual(record);
    expect(decoded.rest.length).toBe(0);
  });
  it('rejects records outside 1..8192 bytes', () => {
    expect(() => encodeRelayRecord({ pad: 'x'.repeat(RELAY_RECORD_MAX_BYTES) })).toThrow(RangeError);
    expect(() => decodeRelayRecord(new Uint8Array([0, 0, 0, 0]))).toThrow(RangeError);
  });
  it('JCS sorts keys recursively', () => {
    expect(jcsCanonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('bind context is the raw SHA-256 of the JCS body minus tlsExporter/issuer/kid', () => {
    const body = { kind: 'bind', circuitId: 'c', tlsExporter: 'aa', issuer: 'i', kid: 'k', lane: 'content' };
    const ctx = relayBindContextSha256(body);
    expect(ctx.length).toBe(32);
    expect(relayBindContextSha256({ ...body, tlsExporter: 'bb' })).toEqual(ctx); // tlsExporter excluded
    expect(relayBindContextSha256({ ...body, circuitId: 'other' })).not.toEqual(ctx);
    expect(RELAY_INNER_ALPN).toBe('cluster-mesh.session-relay.inner.v1');
    expect(RELAY_TLS_EXPORTER_LABEL).toBe('EXPORTER-cluster-mesh-session-relay-v1');
    expect(RELAY_BIND_EVENT_ORDER[0]).toBe('opened');
  });
});
