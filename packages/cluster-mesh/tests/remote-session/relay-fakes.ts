// TEST-ONLY fakes (L-3): a fake A endpoint adapter and a fake L→A transit double,
// usable through the L-1 public exports only (the wiring seam is internal; tests
// register it). Fakes REFUSE missing authorities — an always-allow double does
// not satisfy L-3. Not shipped: this file lives under tests/ and is never packed.
import { relayError } from '../../src/sessions/registry-types.js';
import type { RelayError, RevisionRef } from '../../src/sessions/registry-types.js';
import type { SessionRelayLaneClientV1, SessionRelayConnectParametersV1 } from '../../src/sessions/relay-types.js';
import type { SessionRelayMeshWiringV1 } from '../../src/sessions/relay-wiring.js';
import { runEstablishment } from '../../src/sessions/relay-engine.js';
import { createFakeLaneClient } from './relay-fake-client.js';

export interface FakeAuthorities {
  readonly grantResolver?: { resolve(grantRef: RevisionRef): boolean };
  readonly admissions?: ReadonlySet<string>;
  readonly sourceCredentials?: { resolve(...args: unknown[]): Promise<unknown> };
}

// Fake A endpoint adapter: admits only the admission refs it was seeded with.
export function createFakeEndpointA(admissionIds: readonly string[]) {
  const admissions = new Set(admissionIds);
  return {
    admits(ref: RevisionRef): boolean {
      return admissions.has(ref.id);
    },
  };
}

// Fake L→A transit: forwards only when it holds the adjacent grant.
export function createFakeTransitLA(grantIds: readonly string[]) {
  const grants = new Set(grantIds);
  return {
    holds(grantRef: RevisionRef): boolean {
      return grants.has(grantRef.id);
    },
  };
}

// Fake mesh wiring: runs the frozen establishment vectors through the engine
// (prepare → upgrade/Open/Opened → Bind/Bound) and refuses when authorities are
// missing — DEP-FED stays a source-gap, so a wiring without a grant resolver is
// refused exactly like production.
export function createFakeRelayWiring(authorities: FakeAuthorities, endpointA: ReturnType<typeof createFakeEndpointA>, transitLA: ReturnType<typeof createFakeTransitLA>): SessionRelayMeshWiringV1 {
  return {
    endpointRegistry: endpointA,
    installationSigner: authorities.grantResolver ?? null,
    grantResolver: authorities.grantResolver ?? null,
    tlsPins: null,
    async connect(parameters: SessionRelayConnectParametersV1): Promise<{ status: 'connected'; clientRef: string; sessionRef: SessionRelayConnectParametersV1['sessionRef']; stage: SessionRelayConnectParametersV1['stage']; lanes: readonly string[]; descriptorDigest: string; client: SessionRelayLaneClientV1 } | { status: 'refused'; error: RelayError }> {
      const grantRef = parameters.bindingRef.kind === 'listing' ? parameters.bindingRef.listingGrantRef : parameters.approvedRouteRef;
      if (!authorities.grantResolver || !authorities.grantResolver.resolve(grantRef)) {
        return { status: 'refused', error: relayError('relay_grant_unavailable') };
      }
      if (!transitLA.holds(grantRef)) {
        return { status: 'refused', error: relayError('relay_scope_refused') };
      }
      const result = runEstablishment(fakeVectors(parameters));
      if (result.status !== 'established') return { status: 'refused', error: result.error };
      return {
        status: 'connected',
        clientRef: 'fake-client-ref',
        sessionRef: parameters.sessionRef,
        stage: parameters.stage,
        lanes: parameters.laneSet,
        descriptorDigest: parameters.approvedRouteRef.digest,
        client: createFakeLaneClient(authorities, parameters.sessionRef),
      };
    },
  };
}

// Scripted establishment vectors for the fake B→L→A chain (fixture coordinates
// from chain-wire-coordinates.json: link1 tunnel m_b2d0…, link2 tunnel AEx1…).
function fakeVectors(parameters: SessionRelayConnectParametersV1) {
  const path = ['fixture-B', 'fixture-L', 'fixture-A'];
  const grantRef = parameters.bindingRef.kind === 'listing' ? parameters.bindingRef.listingGrantRef : parameters.approvedRouteRef;
  const base = {
    descriptorDigest: parameters.approvedRouteRef.digest,
    preparationId: 'HW8EdU-fjFRky90tsPXf9g',
    routeId: parameters.approvedRouteRef.id,
    routeRevision: parameters.approvedRouteRef.revision,
    routeGeneration: 1,
    sessionRef: parameters.sessionRef,
    circuitId: 'ayPA1fNdGxH5toPwsKYXNQ',
    lane: parameters.laneSet[0] ?? 'content',
    sessionTraceId: 'eafe895eb8119e6e5d06463590b2ef81',
    endpointAdmissionRefs: [
      { id: 'fixture-B-admission', revision: 1, digest: 'ab9afa476a48beb6c583bd8a773549a2e2b286c6804b5c8a5d5b2a2e434662e4' },
      { id: 'fixture-A-admission', revision: 1, digest: 'b92597938ff231b0a6c9b0b3872531c02af1d510534b1eff7c39dcad0feaed01' },
    ],
  };
  const upstream = { tunnelId: 'm_b2d0HsGIiTlY05vwnmUw', linkGeneration: 1, grantRef, peerProofRef: { id: 'fixture-BL-peer', revision: 1, digest: '5e0066b30011fe50017d201098768ed562de11490e527216dad67c5180171e70' } };
  const downstream = { tunnelId: 'AEx1xKXPb6qpyKIARX3nqA', linkGeneration: 2, grantRef: { id: 'fixture-LA-grant', revision: 1, digest: 'ef60da2e9c126154e91415a1c49d442cce603e344dde47e2e9c68baee95506fd' }, peerProofRef: { id: 'fixture-LA-peer', revision: 1, digest: 'c9eb00ed851901bff9cf9ba52aaf8c3e7f07ec9d5dd7abae39d1fea8c1a1f44e' } };
  const incoming = { format: 'cluster-mesh.session-relay/1', kind: 'open', ...base, tunnelId: upstream.tunnelId, linkGeneration: 1, hopIndex: 0, visitedInstanceIds: [path[0]], adjacentGrantRef: grantRef, peerProofRef: upstream.peerProofRef };
  const outgoing = { ...incoming, tunnelId: downstream.tunnelId, linkGeneration: 2, hopIndex: 1, visitedInstanceIds: [path[0], path[1]], adjacentGrantRef: downstream.grantRef, peerProofRef: downstream.peerProofRef };
  return {
    pathCheck: { path, hopIndex: 0, visited: [path[0]], sender: path[0], receiver: path[1], approved: true, distributed: true, revocationCaughtUp: true, reservationConsumed: false, competingPair: false },
    openPair: {
      preparedCoordinatesVerified: true, reservationUnused: true, competingPair: false,
      incoming, outgoing,
      prepared: { path, circuitId: base.circuitId, lane: base.lane, upstream, downstream, descriptorDigest: base.descriptorDigest, preparationId: base.preparationId, routeId: base.routeId, routeRevision: base.routeRevision, routeGeneration: base.routeGeneration, sessionRef: base.sessionRef, endpointAdmissionRefs: base.endpointAdmissionRefs },
      downstreamReady: true, upstreamReady: true,
      downstreamOpened: { format: 'cluster-mesh.session-relay/1', kind: 'opened', tunnelId: downstream.tunnelId, linkGeneration: 2 },
      upstreamOpened: { format: 'cluster-mesh.session-relay/1', kind: 'opened', tunnelId: upstream.tunnelId, linkGeneration: 1 },
    },
    bindGuard: { alpn: 'cluster-mesh.session-relay.inner.v1', spkiMatches: true, signerRoleMatches: true, signatureValid: true, exporterMatches: true, coordinatesMatch: true, earlyHttp2: false, secondBind: false, strictUtf8: true, jcs: true, duplicateKeys: false, unknownKeys: false, length: 100, bodyLength: 100 },
    socketConstruction: { serverConstruction: 'non-listening-tls-createServer-emit-connection-secureConnection', clientConstruction: 'tls-connect-over-circuit-then-h2-createConnection-same-socket', alpn: 'cluster-mesh.session-relay.inner.v1', contextBytes: 32, secondTls: false, sessionReused: false, events: ['opened', 'tls-complete', 'exporter', 'bind-read-verified', 'B-bind-write-callback', 'B-bind-drain', 'bound-received', 'B-h2-handoff', 'A-bound-write-callback', 'A-bound-drain', 'A-h2-handoff', 'first-handler', 'response-clean-end'] },
  };
}
