// TEST-ONLY fake lane client minted by an established fake chain (L-3). The
// brand is not forgeable from outside; source-* routes without a credential
// lease get a typed endpointRefusal.
import { relayError } from '../../src/sessions/registry-types.js';
import { SESSION_RELAY_LANE_CLIENT_BRAND } from '../../src/sessions/relay-brand.js';
import { relayRouteSpec } from '../../src/sessions/relay-routes.js';
import type { SessionRelayLaneClientV1, SessionRelayLaneResponseV1 } from '../../src/sessions/relay-types.js';
import type { FakeAuthorities } from './relay-fakes.js';

function iterate(events: readonly SessionRelayLaneResponseV1[], closed: { value: boolean }): AsyncIterableIterator<SessionRelayLaneResponseV1> {
  let i = 0;
  return {
    [Symbol.asyncIterator]() { return this; },
    next(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
      if (closed.value || i >= events.length) return Promise.resolve({ done: true, value: undefined });
      return Promise.resolve({ done: false, value: events[i++] });
    },
    return(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}

function emptyStream(routeId: string): AsyncIterableIterator<SessionRelayLaneResponseV1> {
  return iterate([{ routeId, error: relayError('relay_lane_refused') }], { value: false });
}

// Fake lane client minted only by an established fake chain (brand is not
// forgeable from outside). Answers request/stream over the fake transit and
// refuses routes whose authority is missing (source-* without a credential
// lease → typed endpointRefusal).
function createFakeLaneClient(authorities: FakeAuthorities, closed: { value: boolean }): SessionRelayLaneClientV1 {
  const client: SessionRelayLaneClientV1 = {
    [SESSION_RELAY_LANE_CLIENT_BRAND]: 'SessionRelayLaneClientV1',
    async request(parameters) {
      if (closed.value) return { routeId: parameters.routeId, error: relayError('relay_unavailable', true) };
      const spec = relayRouteSpec(parameters.routeId);
      if (!spec) return { routeId: parameters.routeId, error: relayError('relay_lane_refused') };
      if (spec.lane === 'lifecycle' && parameters.routeId.startsWith('source-') && authorities.sourceCredentials) {
        const lease = await authorities.sourceCredentials.resolve();
        if (!lease) return { routeId: parameters.routeId, endpointRefusal: { code: 'source_auth_required' } };
      }
      return { routeId: parameters.routeId, response: { status: spec.successStatus, body: null } };
    },
    stream(parameters) {
      const spec = relayRouteSpec(parameters.routeId);
      if (!spec) return emptyStream(parameters.routeId);
      const events: SessionRelayLaneResponseV1[] = [
        { routeId: parameters.routeId, response: { status: spec.successStatus, body: null } },
      ];
      return iterate(events, closed);
    },
    async close() {
      closed.value = true;
      return { status: 'closed' };
    },
  };
  return client;
}


export { createFakeLaneClient };
