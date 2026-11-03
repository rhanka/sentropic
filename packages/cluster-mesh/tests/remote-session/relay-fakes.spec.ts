import { describe, expect, it } from 'vitest';
import {
  createSessionRelayEndpointConnectorPort,
  isSessionRelayLaneClient,
  type SessionRelayConnectParametersV1,
  type SessionRelayHostCompositionV1,
} from '../../src/sessions/relay.js';
import { clearSessionRelayMeshWiring, registerSessionRelayMeshWiring } from '../../src/sessions/relay-wiring.js';
import { createFakeEndpointA, createFakeRelayWiring, createFakeTransitLA } from './relay-fakes.js';

const connectParameters = {
  sessionRef: { originInstanceId: 'fixture-B', sessionId: 'fixture-session', incarnation: 'fixture-incarnation' },
  approvedRouteRef: { id: 'fixture-id-0', revision: 1, digest: '5c0f39b007457a007a9dfe511978055175212e47a5d0d259fbf2550a635e03a9' },
  stage: 'listing',
  laneSet: ['lifecycle'],
  bindingRef: {
    kind: 'listing',
    listingGrantRef: { id: 'fixture-BL-grant', revision: 1, digest: 'fb3a2d6286ef1c4d390d6587f2b6a0023e1748929def98570a0cb81ca9df324b' },
  },
} as const;

function hostComposition(): SessionRelayHostCompositionV1 {
  return {
    processBindingRef: { id: 'process-1', revision: 1, digest: '0'.repeat(64) },
    sourceCredentials: { resolve: () => Promise.resolve({ lease: true }) },
    now: () => 1_793_520_000_000,
  };
}

const fullAuthorities = {
  grantResolver: { resolve: () => true },
  admissions: new Set(['fixture-B-admission', 'fixture-A-admission']),
  sourceCredentials: { resolve: () => Promise.resolve({ lease: true }) },
};

function registerFakes(authorities = fullAuthorities): void {
  registerSessionRelayMeshWiring(
    createFakeRelayWiring(authorities, createFakeEndpointA(['fixture-B-admission', 'fixture-A-admission']), createFakeTransitLA(['fixture-BL-grant', 'fixture-LA-grant'])),
  );
}

describe('RC2 relay-1 L-3: fake A + fake L→A behind the public API', () => {
  it('connects through prepare → upgrade/Open/Opened → Bind/Bound and mints a branded client', async () => {
    registerFakes();
    try {
      const port = createSessionRelayEndpointConnectorPort(hostComposition());
      const result = await port.connect(connectParameters as SessionRelayConnectParametersV1);
      expect(result.status).toBe('connected');
      if (result.status !== 'connected') return;
      expect(isSessionRelayLaneClient(result.client)).toBe(true);
      expect(result.descriptorDigest).toBe(connectParameters.approvedRouteRef.digest);
      const response = await result.client.request({
        routeId: 'listing-grant-fetch',
        pathParameters: { sessionId: 'fixture-session', grantId: 'NJKtZdBalz_vjIJVIe60Gg' },
        body: null,
      });
      expect(response).toMatchObject({ routeId: 'listing-grant-fetch', response: { status: 200 } });
      const events: unknown[] = [];
      for await (const event of result.client.stream({ routeId: 'action-stream', pathParameters: { bindingId: 'b', sourceSessionId: 's' }, body: null })) events.push(event);
      expect(events.length).toBeGreaterThan(0);
      await expect(result.client.close({ reason: 'relay_auth_required' })).resolves.toEqual({ status: 'closed' });
      await expect(result.client.close({ reason: 'relay_auth_required' })).resolves.toEqual({ status: 'closed' });
    } finally {
      clearSessionRelayMeshWiring();
    }
  });

  it('fakes refuse missing authorities (no always-allow double)', async () => {
    registerFakes({ admissions: new Set(), sourceCredentials: { resolve: () => Promise.resolve(null) } });
    try {
      const port = createSessionRelayEndpointConnectorPort(hostComposition());
      const refused = await port.connect(connectParameters as SessionRelayConnectParametersV1);
      expect(refused).toMatchObject({ status: 'refused', error: { code: 'relay_grant_unavailable' } });
    } finally {
      clearSessionRelayMeshWiring();
    }
    registerFakes({ ...fullAuthorities, grantResolver: { resolve: () => false } });
    try {
      const port = createSessionRelayEndpointConnectorPort(hostComposition());
      const refused = await port.connect(connectParameters as SessionRelayConnectParametersV1);
      expect(refused).toMatchObject({ status: 'refused', error: { code: 'relay_grant_unavailable' } });
    } finally {
      clearSessionRelayMeshWiring();
    }
  });

  it('source routes without a credential lease get a typed endpointRefusal', async () => {
    registerFakes({ ...fullAuthorities, sourceCredentials: { resolve: () => Promise.resolve(null) } });
    try {
      const port = createSessionRelayEndpointConnectorPort(hostComposition());
      const result = await port.connect(connectParameters as SessionRelayConnectParametersV1);
      expect(result.status).toBe('connected');
      if (result.status !== 'connected') return;
      const response = await result.client.request({ routeId: 'source-renew', pathParameters: { bindingId: 'b', sourceSessionId: 's' }, body: {} });
      expect(response).toMatchObject({ routeId: 'source-renew', endpointRefusal: { code: 'source_auth_required' } });
    } finally {
      clearSessionRelayMeshWiring();
    }
  });
});

describe('RC2 relay-1 L-2: composition contract enforced at the port', () => {
  it('rejects host composition carrying sockets/URLs/keys/grants with TypeError', () => {
    expect(() => createSessionRelayEndpointConnectorPort({ ...hostComposition(), socket: {} } as never)).toThrow(TypeError);
    expect(() => createSessionRelayEndpointConnectorPort({ ...hostComposition(), url: 'https://x.invalid' } as never)).toThrow(TypeError);
    expect(() => createSessionRelayEndpointConnectorPort({ ...hostComposition(), adjacentGrantRef: {} } as never)).toThrow(TypeError);
    expect(() => createSessionRelayEndpointConnectorPort({ processBindingRef: { id: 'p', revision: 1, digest: '0'.repeat(64) } } as never)).toThrow(TypeError);
  });
});
