// TEST-ONLY fake lane transport + engine mint (L-3): the fake wiring hands the
// REAL lane client engine (relay-lane-client) a scripted transport, so the
// public API path exercises the actual L-6 iterator discipline. The brand is
// not forgeable from outside. Missing authorities refuse with typed lane
// errors — endpointRefusal is only ever a real endpoint record, never
// synthesized (runtimeComposition.absent: missing provider/null lease →
// relay_auth_required).
import { relayError } from '../../src/sessions/registry-types.js';
import type { SessionRef } from '../../src/sessions/registry-types.js';
import { relayRouteSpec } from '../../src/sessions/relay-routes.js';
import { createLaneClientEngine } from '../../src/sessions/relay-lane-client.js';
import type { LaneStreamSourceV1, SessionRelayLaneCallV1, SessionRelayLaneTransportV1 } from '../../src/sessions/relay-lane-client.js';
import type { SessionRelayLaneClientV1 } from '../../src/sessions/relay-types.js';
import type { FakeAuthorities } from './relay-fakes.js';

// Scripted fake L→A transport: answers from the route matrix; unknown routes
// refuse with relay_lane_refused. Source-auth headers applied by the engine are
// accepted here (mesh-internal sink) but never exposed to the caller.
function createFakeLaneTransport(): SessionRelayLaneTransportV1 & { closed: () => boolean } {
  let closed = false;
  const answer = (call: SessionRelayLaneCallV1): unknown => {
    const spec = relayRouteSpec(call.routeId);
    if (!spec) return { routeId: call.routeId, error: relayError('relay_lane_refused') };
    return { routeId: call.routeId, response: { status: spec.successStatus, body: null } };
  };
  return {
    async request(call) {
      if (closed) throw relayError('relay_unavailable', true);
      return answer(call);
    },
    openStream(call) {
      const records: unknown[] = closed ? [] : [answer(call)];
      let i = 0;
      let cancelled = false;
      const source: LaneStreamSourceV1 = {
        next: () => {
          if (cancelled || i >= records.length) return Promise.resolve({ done: true });
          return Promise.resolve({ done: false, record: records[i++] });
        },
        cancel: () => {
          cancelled = true;
        },
      };
      return source;
    },
    close() {
      closed = true;
    },
    closed: () => closed,
  };
}

// Fake lane client minted only by an established fake chain, backed by the real
// engine over the scripted transport.
function createFakeLaneClient(authorities: FakeAuthorities, sessionRef: SessionRef): SessionRelayLaneClientV1 {
  return createLaneClientEngine({
    sessionRef,
    sourceCredentials: (authorities.sourceCredentials as FakeAuthorities['sourceCredentials']) ?? null,
    transport: createFakeLaneTransport(),
    now: () => 1_793_520_000_000,
  });
}

export { createFakeLaneClient };
