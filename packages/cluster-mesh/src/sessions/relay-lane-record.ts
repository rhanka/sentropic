// INTERNAL shared record/transport shapes for the lane engine (not packed):
// the stream source handed to the iterator by the mesh transport, the lane
// call object, the transport seam itself, and record correlation. Only records
// actually produced by the matched endpoint pass through (response /
// endpointRefusal); this layer never synthesizes endpointRefusal bytes.
import { relayError } from './registry-types.js';
import type { RelayError } from './registry-types.js';
import type { SessionRelayLaneResponseV1 } from './relay-types.js';

// Source handed to the iterator by the mesh transport: records are raw decoded
// route records; partial=true marks a mid-event EOF.
export interface LaneStreamSourceV1 {
  next(): Promise<{ done: boolean; record?: unknown; partial?: boolean }>;
  cancel(): void;
}

export interface SessionRelayLaneCallV1 {
  readonly routeId: string;
  readonly pathParameters: Record<string, string | number>;
  readonly body: unknown;
}

// Internal transport seam: supplied by mesh wiring (tests register fakes).
export interface SessionRelayLaneTransportV1 {
  request(call: SessionRelayLaneCallV1, signal: AbortSignal, sourceAuthHeaders: Record<string, string>): Promise<unknown>;
  openStream(call: SessionRelayLaneCallV1, signal: AbortSignal, sourceAuthHeaders: Record<string, string>): LaneStreamSourceV1;
  close(): void;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isRelayError(value: unknown): value is RelayError {
  return isPlainObject(value) && value.format === 'cluster-mesh.session-relay/1' && value.kind === 'error' && typeof value.code === 'string';
}

// Correlate one raw transport record to a lane response.
export function correlate(routeId: string, record: unknown): { response: SessionRelayLaneResponseV1 } | { error: RelayError } {
  if (!isPlainObject(record)) return { error: relayError('relay_protocol_refused') };
  if ('routeId' in record && record.routeId !== routeId) return { error: relayError('relay_lane_refused') };
  if ('error' in record) {
    return isRelayError(record.error) ? { response: { routeId, error: record.error } } : { error: relayError('relay_protocol_refused') };
  }
  if ('endpointRefusal' in record) return { response: { routeId, endpointRefusal: record.endpointRefusal } };
  if ('response' in record) return { response: { routeId, response: record.response } };
  return { error: relayError('relay_protocol_refused') };
}
