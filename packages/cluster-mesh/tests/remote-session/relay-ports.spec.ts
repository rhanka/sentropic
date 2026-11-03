import { describe, expect, it } from 'vitest';
import {
  validateConnectParameters,
  validateLaneCloseParameters,
  validateLaneRequestParameters,
  validateLaneStreamParameters,
  SESSION_RELAY_LANE_REQUEST_ROUTE_IDS,
  SESSION_RELAY_LANE_STREAM_ROUTE_IDS,
} from '../../src/sessions/relay.js';
// RC2.contract r3 pins (branch pin, BRANCH.md): manifest JSON 88823475…,
// MANIFEST.sha256 self 6245d3ae…; port vector digests from the r3 manifest
// ports[].methods[].vectorSha256 entries.
const R3_MANIFEST_JSON_SHA256 = '88823475eca151d908450e4abadcac7b2b60d4b5ea16bae0f590d419fa394565';
const R3_MANIFEST_SEAL_SHA256 = '6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715';
const VECTOR_SHA256 = {
  connect: '971a01f435f1def25c1059fcc56f325036edfdbe4eff5a2563228db319427feb',
  request: 'bf4a60508ccbc869dfddedf89c30211e01316ba54ebbf1bd168a6212e13c0fbd',
  stream: '02f56eaee4107ae3aa7609ad985531d276e9c4468ceb9f0168e815a813da2fba',
  close: '0c2dd98198a54e31683377645578c7f101d5d0cefdfdba324bd2c5df68c5751f',
} as const;

// vectors/port-SessionRelayEndpointConnectorPortV1-connect.json (r3)
const connectPositive = {
  sessionRef: {
    originInstanceId: 'fixture-B',
    sessionId: 'fixture-session',
    incarnation: 'fixture-incarnation',
  },
  approvedRouteRef: {
    id: 'fixture-id-0',
    revision: 1,
    digest: '5c0f39b007457a007a9dfe511978055175212e47a5d0d259fbf2550a635e03a9',
  },
  stage: 'listing',
  laneSet: ['lifecycle'],
  bindingRef: {
    kind: 'listing',
    listingGrantRef: {
      id: 'fixture-id-0',
      revision: 1,
      digest: 'ff5810f8d99004d5b88eecb44f5ec15898c87ce91c4c2a0a1926eccb4832f4c1',
    },
  },
} as const;

const connectNegative = { ...connectPositive, arbitraryUrl: 'https://forbidden.invalid/' } as const;

// vectors/port-SessionRelayLaneClientV1-{request,stream,close}.json (r3)
const requestPositive = {
  routeId: 'listing-grant-fetch',
  pathParameters: { sessionId: 'fixture-session', grantId: 'NJKtZdBalz_vjIJVIe60Gg' },
  body: null,
} as const;
const requestNegative = { ...requestPositive, arbitraryUrl: 'https://forbidden.invalid/' } as const;
const streamPositive = {
  routeId: 'source-control',
  pathParameters: { bindingId: 'fixture-binding', sourceSessionId: 'fixture-source-session' },
  body: null,
} as const;
const streamNegative = { ...streamPositive, arbitraryUrl: 'https://forbidden.invalid/' } as const;
const closePositive = { reason: 'relay_auth_required' } as const;
const closeNegative = { ...closePositive, arbitraryUrl: 'https://forbidden.invalid/' } as const;

describe('RC2 relay-1 preparation: r3 pins', () => {
  it('pins the r3 contract manifest digests recorded in BRANCH.md', () => {
    expect(R3_MANIFEST_JSON_SHA256).toMatch(/^[a-f0-9]{64}$/);
    expect(R3_MANIFEST_SEAL_SHA256).toBe('6245d3ae51f601195926bc36600d1097cef30694f3feb01f79f1a7ec9fa17715');
    expect(Object.values(VECTOR_SHA256)).toHaveLength(4);
    for (const digest of Object.values(VECTOR_SHA256)) expect(digest).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('RC2 relay-1 preparation: port parameter shapes (r3 vectors)', () => {
  it('accepts the connect positive vector shape and rejects the unlisted-argument negative', () => {
    expect(validateConnectParameters(connectPositive)).toBeNull();
    expect(validateConnectParameters(connectNegative)).toBe('unlisted key: arbitraryUrl');
  });

  it('accepts the request/stream/close positive vector shapes and rejects their negatives', () => {
    expect(validateLaneRequestParameters(requestPositive)).toBeNull();
    expect(validateLaneRequestParameters(requestNegative)).toBe('unlisted key: arbitraryUrl');
    expect(validateLaneStreamParameters(streamPositive)).toBeNull();
    expect(validateLaneStreamParameters(streamNegative)).toBe('unlisted key: arbitraryUrl');
    expect(validateLaneCloseParameters(closePositive)).toBeNull();
    expect(validateLaneCloseParameters(closeNegative)).toBe('unlisted key: arbitraryUrl');
  });

  it('covers exactly the 28 closed request routeIds and the 2 stream routeIds of the r3 manifest', () => {
    expect([...SESSION_RELAY_LANE_REQUEST_ROUTE_IDS].sort()).toEqual([
      'action-claim', 'action-nonce', 'action-result', 'activation-ack', 'archive-segment',
      'archive-snapshot', 'chat-events', 'cli-proof', 'continuity-ack', 'drive-binding-ack',
      'drive-binding-fetch', 'freshness-publish', 'grant-fetch', 'history-admission',
      'history-auth', 'lifecycle-publish', 'listing-grant-ack', 'listing-grant-fetch',
      'listing-publish', 'native-challenge', 'policy-fetch', 'pty-fragments', 'snapshot-publish',
      'source-open', 'source-renew', 'typed-events',
    ]);
    expect([...SESSION_RELAY_LANE_STREAM_ROUTE_IDS].sort()).toEqual(['action-stream', 'source-control']);
  });

  it('rejects unknown routeIds, wrong path parameter names and bodyless-route bodies', () => {
    expect(validateLaneRequestParameters({ routeId: 'relay-prepare', pathParameters: {}, body: null })).toMatch(/unknown routeId/);
    expect(validateLaneRequestParameters({ routeId: 'listing-grant-fetch', pathParameters: { sessionId: 's', grantId: 'g', extra: 'x' }, body: null })).toMatch(/unlisted path parameter/);
    expect(validateLaneRequestParameters({ routeId: 'listing-grant-fetch', pathParameters: { sessionId: 's' }, body: null })).toMatch(/missing path parameter/);
    expect(validateLaneRequestParameters({ routeId: 'listing-grant-fetch', pathParameters: { sessionId: 's', grantId: 'g' }, body: {} })).toMatch(/body must be null/);
    expect(validateLaneStreamParameters({ routeId: 'action-stream', pathParameters: { bindingId: 'b', sourceSessionId: 's' }, body: null })).toBeNull();
    expect(validateLaneCloseParameters({ reason: 'not-a-code' })).toMatch(/unknown close reason/);
  });
});
