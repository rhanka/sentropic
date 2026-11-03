// INTERNAL fail-closed skeleton lane client — NOT part of the packed public
// surface (not re-exported from src/sessions/relay.ts; isSessionRelayLaneClient
// is the only public touchpoint). Until the wire engine lands, every lane
// operation resolves to its typed refusal: never throws, never fabricates
// endpointRefusal bytes, never fills a source-gap field locally.
import { relayError } from './registry-types.js';
import { SESSION_RELAY_LANE_CLIENT_BRAND } from './relay-brand.js';
import type {
  SessionRelayConnectCallOptions,
  SessionRelayLaneClientV1,
  SessionRelayLaneCloseResultV1,
  SessionRelayLaneResponseV1,
} from './relay-types.js';
import { validateLaneCloseParameters, validateLaneRequestParameters, validateLaneStreamParameters } from './relay-validate.js';

export function isSessionRelayLaneClient(value: unknown): value is SessionRelayLaneClientV1 {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[SESSION_RELAY_LANE_CLIENT_BRAND] === 'SessionRelayLaneClientV1'
  );
}

function assertParameters(parameters: unknown, method: string): asserts parameters is Record<string, unknown> {
  if (typeof parameters !== 'object' || parameters === null || Array.isArray(parameters)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: parameters must be a single named object`);
  }
}

function assertOptions(options: unknown, method: string): asserts options is SessionRelayConnectCallOptions | undefined {
  if (options === undefined) return;
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: options must be an object`);
  }
  if ('signal' in options && options.signal !== undefined && !(options.signal instanceof AbortSignal)) {
    throw new TypeError(`SessionRelayLaneClientV1.${method}: options.signal must be an AbortSignal`);
  }
}

// Fail-closed skeleton lane client: handed out only by a connected engine.
export function createSkeletonLaneClient(): SessionRelayLaneClientV1 {
  let closed = false;
  const unavailable = (routeId: string): SessionRelayLaneResponseV1 => ({
    routeId,
    error: relayError('relay_unavailable', true),
  });
  const client: SessionRelayLaneClientV1 = {
    [SESSION_RELAY_LANE_CLIENT_BRAND]: 'SessionRelayLaneClientV1',
    async request(parameters, options) {
      assertParameters(parameters, 'request');
      assertOptions(options, 'request');
      const defect = validateLaneRequestParameters(parameters);
      if (defect) return { routeId: String((parameters as { routeId?: unknown }).routeId ?? ''), error: relayError('relay_protocol_refused') };
      if (closed || options?.signal?.aborted) {
        return { routeId: parameters.routeId, error: relayError('relay_unavailable', true) };
      }
      return unavailable(parameters.routeId);
    },
    stream(parameters, options) {
      assertParameters(parameters, 'stream');
      assertOptions(options, 'stream');
      const defect = validateLaneStreamParameters(parameters);
      const routeId = defect ? String((parameters as { routeId?: unknown }).routeId ?? '') : parameters.routeId;
      const first: SessionRelayLaneResponseV1 = defect
        ? { routeId, error: relayError('relay_protocol_refused') }
        : { routeId, error: relayError('relay_unavailable', true) };
      let yielded = false;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        next(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
          if (yielded) return Promise.resolve({ done: true, value: undefined });
          yielded = true;
          return Promise.resolve({ done: false, value: first });
        },
        return(): Promise<IteratorResult<SessionRelayLaneResponseV1>> {
          yielded = true;
          return Promise.resolve({ done: true, value: undefined });
        },
      };
    },
    async close(parameters) {
      assertParameters(parameters, 'close');
      const defect = validateLaneCloseParameters(parameters);
      if (defect) throw new TypeError(`SessionRelayLaneClientV1.close: ${defect}`);
      closed = true;
      return { status: 'closed' } satisfies SessionRelayLaneCloseResultV1;
    },
  };
  return client;
}
