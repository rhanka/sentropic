// TEST-ONLY shared kit for the L-6 conformance specs: scripted lane transports
// and engine fixtures. Never shipped.
import type { SessionRef } from '../../src/sessions/registry-types.js';
import { createLaneClientEngine } from '../../src/sessions/relay-lane-client.js';
import type { LaneStreamSourceV1, SessionRelayLaneCallV1, SessionRelayLaneTransportV1 } from '../../src/sessions/relay-lane-client.js';
import type { SessionRelayLaneClientV1, SessionRelayLaneResponseV1, SessionRelaySourceCredentialLeaseV1 } from '../../src/sessions/relay-types.js';

export const NOW = 1_793_520_000_000;
export const SESSION: SessionRef = { originInstanceId: 'fixture-B', sessionId: 'fixture-session', incarnation: 'fixture-incarnation' };

export const SOURCE_ROUTE = { routeId: 'source-renew', pathParameters: { bindingId: 'b', sourceSessionId: 's' }, body: {} } as const;
export const MESH_ROUTE = { routeId: 'listing-grant-fetch', pathParameters: { sessionId: 'fixture-session', grantId: 'NJKtZdBalz_vjIJVIe60Gg' }, body: null } as const;
export const STREAM_ROUTE = { routeId: 'action-stream', pathParameters: { bindingId: 'b', sourceSessionId: 's' }, body: null } as const;

export function lease(overrides: Partial<SessionRelaySourceCredentialLeaseV1> = {}): SessionRelaySourceCredentialLeaseV1 {
  return { sessionRef: SESSION, targetDigest: null, expiresAt: NOW + 60_000, applyTo() {}, ...overrides };
}

export interface Script {
  records?: Array<{ done?: boolean; record?: unknown; partial?: boolean }>;
  hang?: boolean;
  requestHang?: boolean;
}

export function scriptedTransport(script: Script) {
  const state = { openStreamCalls: 0, cancelCalls: 0, closeCalls: 0, requestCalls: 0 };
  const transport: SessionRelayLaneTransportV1 = {
    async request(call: SessionRelayLaneCallV1) {
      state.requestCalls += 1;
      if (script.requestHang) return new Promise<unknown>(() => {});
      return { routeId: call.routeId, response: { status: 200 } };
    },
    openStream(call: SessionRelayLaneCallV1) {
      state.openStreamCalls += 1;
      const records = script.records ?? [{ done: false, record: { routeId: call.routeId, response: { status: 200 } } }];
      let i = 0;
      let cancelled = false;
      const source: LaneStreamSourceV1 = {
        next: () => {
          if (script.hang) return new Promise(() => {});
          if (cancelled || i >= records.length) return Promise.resolve({ done: true });
          return Promise.resolve(records[i++] as { done: boolean; record?: unknown; partial?: boolean });
        },
        cancel: () => {
          cancelled = true;
          state.cancelCalls += 1;
        },
      };
      return source;
    },
    close() {
      state.closeCalls += 1;
    },
  };
  return { transport, state };
}

export function engine(
  transport: SessionRelayLaneTransportV1,
  provider: { resolve: (ctx: unknown) => Promise<unknown> } | null = { resolve: () => Promise.resolve(lease()) },
): SessionRelayLaneClientV1 {
  return createLaneClientEngine({ sessionRef: SESSION, sourceCredentials: provider, transport, now: () => NOW });
}

export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

export async function drain(iterator: AsyncIterableIterator<SessionRelayLaneResponseV1>): Promise<SessionRelayLaneResponseV1[]> {
  const out: SessionRelayLaneResponseV1[] = [];
  for await (const event of iterator) out.push(event);
  return out;
}
