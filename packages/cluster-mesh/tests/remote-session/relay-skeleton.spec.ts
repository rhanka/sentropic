import { describe, expect, it } from 'vitest';
import {
  createSessionRelayEndpointConnectorPort,
  isSessionRelayLaneClient,
  type SessionRelayConnectParametersV1,
  type SessionRelayEndpointConnectorPortV1,
  type SessionRelayHostCompositionV1,
  type SessionRelayLaneClientV1,
} from '../../src/sessions/relay.js';
import { createSkeletonLaneClient } from '../../src/sessions/relay-skeleton.js';
import {
  clearSessionRelayMeshWiring,
  registerSessionRelayMeshWiring,
  type SessionRelayMeshWiringV1,
} from '../../src/sessions/relay-wiring.js';

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

const requestPositive = {
  routeId: 'listing-grant-fetch',
  pathParameters: { sessionId: 'fixture-session', grantId: 'NJKtZdBalz_vjIJVIe60Gg' },
  body: null,
} as const;
const streamPositive = {
  routeId: 'source-control',
  pathParameters: { bindingId: 'fixture-binding', sourceSessionId: 'fixture-source-session' },
  body: null,
} as const;
const closePositive = { reason: 'relay_auth_required' } as const;
const connectNegative = { ...connectPositive, arbitraryUrl: 'https://forbidden.invalid/' } as const;

function hostComposition(): SessionRelayHostCompositionV1 {
  return {
    processBindingRef: { id: 'process-1', revision: 1, digest: '0'.repeat(64) },
    sourceCredentials: { resolve: () => Promise.resolve(null) },
    now: () => 1_793_520_000_000,
  };
}

describe('RC2 relay-1 preparation: skeleton lane client conformance surface', () => {
  it('request/stream refuse with typed errors and close is idempotent and outcome-neutral', async () => {
    const client = createSkeletonLaneClient();
    expect(isSessionRelayLaneClient(client)).toBe(true);
    const refused = await client.request(requestPositive as never);
    expect(refused).toMatchObject({ routeId: 'listing-grant-fetch', error: { code: 'relay_unavailable' } });
    const events: unknown[] = [];
    for await (const event of client.stream(streamPositive as never)) events.push(event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ routeId: 'source-control', error: { code: 'relay_unavailable' } });
    await expect(client.close(closePositive as never)).resolves.toEqual({ status: 'closed' });
    await expect(client.close(closePositive as never)).resolves.toEqual({ status: 'closed' });
    await expect(client.request(requestPositive as never)).resolves.toMatchObject({ error: { code: 'relay_unavailable' } });
  });

  it('skeleton methods throw TypeError only for invalid JavaScript API use', async () => {
    const client = createSkeletonLaneClient();
    await expect(client.request(null as never)).rejects.toBeInstanceOf(TypeError);
    await expect(client.close(undefined as never)).rejects.toBeInstanceOf(TypeError);
    await expect(client.request(requestPositive as never, { signal: 'x' } as never)).rejects.toBeInstanceOf(TypeError);
  });
});

describe('RC2 relay-1 preparation: fail-closed skeleton (DEP-FED source-gap, live routes disabled)', () => {
  it('refuses connect with relay_grant_unavailable and no client when no mesh wiring is registered', async () => {
    clearSessionRelayMeshWiring();
    const port: SessionRelayEndpointConnectorPortV1 = createSessionRelayEndpointConnectorPort(hostComposition());
    const result = await port.connect(connectPositive as SessionRelayConnectParametersV1);
    expect(result.status).toBe('refused');
    expect(result).toMatchObject({ error: { format: 'cluster-mesh.session-relay/1', kind: 'error', code: 'relay_grant_unavailable' } });
    expect('client' in result).toBe(false);
  });

  it('refuses with relay_unavailable when the caller abort is already signalled', async () => {
    clearSessionRelayMeshWiring();
    const port = createSessionRelayEndpointConnectorPort(hostComposition());
    const controller = new AbortController();
    controller.abort();
    const result = await port.connect(connectPositive as SessionRelayConnectParametersV1, { signal: controller.signal });
    expect(result).toMatchObject({ status: 'refused', error: { code: 'relay_unavailable' } });
  });

  it('throws TypeError only for invalid JavaScript API use, never for authority failures', async () => {
    const port = createSessionRelayEndpointConnectorPort(hostComposition());
    await expect(port.connect(null as never)).rejects.toBeInstanceOf(TypeError);
    await expect(port.connect([] as never)).rejects.toBeInstanceOf(TypeError);
    await expect(port.connect('x' as never)).rejects.toBeInstanceOf(TypeError);
    await expect(port.connect(connectPositive as never, { signal: 42 } as never)).rejects.toBeInstanceOf(TypeError);
    await expect(port.connect(connectPositive as never, [] as never)).rejects.toBeInstanceOf(TypeError);
    // schema-shape violations are typed refusals, not throws
    const bad = await port.connect(connectNegative as never);
    expect(bad).toMatchObject({ status: 'refused', error: { code: 'relay_protocol_refused' } });
  });

  it('never instantiates a lane client from a clientRef string (brand is not forgeable)', async () => {
    clearSessionRelayMeshWiring();
    const port = createSessionRelayEndpointConnectorPort(hostComposition());
    const refused = await port.connect(connectPositive as SessionRelayConnectParametersV1);
    expect(refused.status).toBe('refused');
    const forged = { clientRef: 'AAAAAAAAAAAAAAAAAAAAAA' } as unknown as SessionRelayLaneClientV1;
    expect(isSessionRelayLaneClient(forged)).toBe(false);
    expect(isSessionRelayLaneClient(null)).toBe(false);
    expect(isSessionRelayLaneClient({})).toBe(false);
  });
});

describe('RC2 relay-1 preparation: internal mesh-wiring seam is not part of the packed surface', () => {
  it('registers and clears wiring for tests only; public factory stays fail-closed without it', async () => {
    const fakeWiring = { marker: 'fake' } as unknown as SessionRelayMeshWiringV1;
    registerSessionRelayMeshWiring(fakeWiring);
    clearSessionRelayMeshWiring();
    const port = createSessionRelayEndpointConnectorPort(hostComposition());
    const result = await port.connect(connectPositive as SessionRelayConnectParametersV1);
    expect(result.status).toBe('refused');
  });
});
