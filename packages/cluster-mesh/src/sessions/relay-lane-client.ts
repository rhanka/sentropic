// INTERNAL lane client engine (L-6 + runtimeComposition.failures) — NOT
// packed; minted only by mesh wiring through the transport seam. Implements
// the branded SessionRelayLaneClientV1: request/stream/close with the frozen
// iterator discipline (relay-lane-stream), source-credential lease resolution
// immediately before each RC0 send, and fail-closed mapping — typed refusals
// never throw; only invalid JavaScript API use throws TypeError.
import { relayError } from './registry-types.js';
import type { RelayError } from './registry-types.js';
import { SESSION_RELAY_LANE_CLIENT_BRAND } from './relay-brand.js';
import { relayRouteSpec } from './relay-routes.js';
import { validateLaneCloseParameters, validateLaneRequestParameters, validateLaneStreamParameters } from './relay-validate.js';
import { createLaneStreamIterator } from './relay-lane-stream.js';
import { applyLease, assertOptions, assertParameters, neverAbort, RC0_PATH_PREFIX, resolveLease } from './relay-lane-lease.js';
import type { LaneClientEngineDepsV1 } from './relay-lane-lease.js';
import { isRelayError } from './relay-lane-record.js';
import type { SessionRelayLaneCallV1 } from './relay-lane-record.js';
import type {
  SessionRelayLaneClientV1,
  SessionRelayLaneCloseResultV1,
  SessionRelayLaneResponseV1,
} from './relay-types.js';

export type { LaneClientEngineDepsV1, SessionRelayLaneCallV1 };
export type { LaneStreamSourceV1, SessionRelayLaneTransportV1 } from './relay-lane-record.js';

export function createLaneClientEngine(deps: LaneClientEngineDepsV1): SessionRelayLaneClientV1 {
  let closed = false;
  const closeListeners = new Set<() => void>();

  const unavailable = (routeId: string): SessionRelayLaneResponseV1 => ({ routeId, error: relayError('relay_unavailable', true) });

  const prepare = async (
    routeId: string,
    pathParameters: Record<string, string | number>,
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<{ call: SessionRelayLaneCallV1; headers: Record<string, string> } | { error: RelayError }> => {
    const call: SessionRelayLaneCallV1 = { routeId, pathParameters, body };
    const spec = relayRouteSpec(routeId);
    if (!spec) return { error: relayError('relay_lane_refused') };
    if (closed || signal?.aborted) return { error: relayError('relay_unavailable', true) };
    let headers: Record<string, string> = {};
    if (spec.path.startsWith(RC0_PATH_PREFIX)) {
      const lease = await resolveLease(deps, call, signal);
      if ('error' in lease) return lease;
      if (closed || signal?.aborted) return { error: relayError('relay_unavailable', true) };
      const applied = applyLease(lease.lease);
      if (!applied) return { error: relayError('relay_grant_unavailable') };
      headers = applied;
    }
    if (closed || signal?.aborted) return { error: relayError('relay_unavailable', true) };
    return { call, headers };
  };

  const client: SessionRelayLaneClientV1 = {
    [SESSION_RELAY_LANE_CLIENT_BRAND]: 'SessionRelayLaneClientV1',
    async request(parameters, options) {
      assertParameters(parameters, 'request');
      assertOptions(options, 'request');
      const defect = validateLaneRequestParameters(parameters);
      const routeId = defect ? String(parameters.routeId ?? '') : parameters.routeId;
      if (defect) return { routeId, error: relayError('relay_protocol_refused') };
      if (closed || options?.signal?.aborted) return unavailable(routeId);
      let onClose: (() => void) | undefined;
      const fenced = new Promise<SessionRelayLaneResponseV1>((resolve) => {
        onClose = () => resolve(unavailable(routeId));
        closeListeners.add(onClose);
      });
      try {
        const prepared = await Promise.race([prepare(routeId, parameters.pathParameters, parameters.body, options?.signal), fenced]);
        if ('error' in prepared) return { routeId, error: prepared.error }; // prepare failure or fenced by close()
        if (!('call' in prepared)) return unavailable(routeId);
        try {
          const record = await Promise.race([
            deps.transport.request(prepared.call, options?.signal ?? neverAbort(), prepared.headers),
            fenced,
          ]);
          if (closed || options?.signal?.aborted) return unavailable(routeId);
          if (typeof record !== 'object' || record === null) return { routeId, error: relayError('relay_protocol_refused') };
          const rec = record as Record<string, unknown>;
          if ('routeId' in rec && rec.routeId !== routeId) return { routeId, error: relayError('relay_lane_refused') };
          if ('error' in rec && isRelayError(rec.error)) return { routeId, error: rec.error };
          if ('endpointRefusal' in rec) return { routeId, endpointRefusal: rec.endpointRefusal };
          if ('response' in rec) return { routeId, response: rec.response };
          return { routeId, error: relayError('relay_protocol_refused') };
        } catch (error) {
          if (closed || options?.signal?.aborted) return unavailable(routeId);
          if (isRelayError(error)) return { routeId, error };
          return unavailable(routeId);
        }
      } finally {
        if (onClose) closeListeners.delete(onClose);
      }
    },
    stream(parameters, options) {
      assertParameters(parameters, 'stream');
      assertOptions(options, 'stream');
      const defect = validateLaneStreamParameters(parameters);
      const routeId = defect ? String((parameters as { routeId?: unknown }).routeId ?? '') : parameters.routeId;
      return createLaneStreamIterator(
        routeId,
        async () => {
          if (defect) return { error: relayError('relay_protocol_refused') };
          const prepared = await prepare(routeId, parameters.pathParameters, parameters.body, options?.signal);
          if ('error' in prepared) return prepared;
          try {
            return { source: deps.transport.openStream(prepared.call, options?.signal ?? neverAbort(), prepared.headers) };
          } catch (error) {
            if (options?.signal?.aborted || closed) return { error: relayError('relay_unavailable', true) };
            if (isRelayError(error)) return { error };
            return { error: relayError('relay_unavailable', true) };
          }
        },
        options?.signal,
        { isClosed: () => closed, onClose: (listener) => closeListeners.add(listener) },
      );
    },
    async close(parameters) {
      assertParameters(parameters, 'close');
      const defect = validateLaneCloseParameters(parameters);
      if (defect) throw new TypeError(`SessionRelayLaneClientV1.close: ${defect}`);
      // Idempotent and outcome-neutral: fences all lanes, resolves pending
      // finite requests with relay_unavailable and pending stream next() with
      // one error then end; the result carries no action outcome.
      closed = true;
      for (const listener of [...closeListeners]) listener();
      closeListeners.clear();
      deps.transport.close();
      return { status: 'closed' } satisfies SessionRelayLaneCloseResultV1;
    },
  };
  return client;
}
