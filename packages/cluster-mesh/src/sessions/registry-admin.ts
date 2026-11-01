import { LISTING_STAGE_ROUTES, OBSERVATION_QUEUE_CAP } from './registry-types.js';
import type {
  EmitResult,
  ObservationRecord,
  SessionRef,
} from './registry-types.js';
import { sessionKey } from './registry-store.js';
import type { RegistryState } from './registry-store.js';

export function reportSplitBrain(
  state: RegistryState,
  ref: SessionRef,
  left: { readonly writerEpoch: number; readonly originRevision: number; readonly digest: string },
  right: { readonly writerEpoch: number; readonly originRevision: number; readonly digest: string },
): { readonly quarantined: boolean } {
  const row = state.sessions.get(sessionKey(ref));
  if (row === undefined) return { quarantined: false };
  if (
    left.writerEpoch === right.writerEpoch &&
    left.originRevision === right.originRevision &&
    left.digest !== right.digest
  ) {
    row.quarantined = true;
    return { quarantined: true };
  }
  return { quarantined: false };
}

export function isQuarantined(state: RegistryState, ref: SessionRef): boolean {
  return state.sessions.get(sessionKey(ref))?.quarantined ?? false;
}

export function assertListingStageRoute(state: RegistryState, method: string, path: string): { readonly admitted: boolean } {
  void state;
  return { admitted: (LISTING_STAGE_ROUTES as readonly string[]).includes(`${method} ${path}`) };
}

function validObservation(observation: ObservationRecord): boolean {
  return (
    observation.format === 'cluster-mesh.session-observation/1' &&
    observation.kind === 'observation' &&
    typeof observation.observerRef === 'string' &&
    typeof observation.sessionTraceId === 'string' &&
    typeof observation.observedAt === 'number' &&
    Number.isFinite(observation.observedAt)
  );
}

export function emitObservation(state: RegistryState, observation: ObservationRecord): EmitResult {
  if (!validObservation(observation)) {
    state.droppedObservations += 1;
    return { status: 'dropped', dropped: state.droppedObservations };
  }
  if (state.observations.length >= OBSERVATION_QUEUE_CAP) {
    state.droppedObservations += 1;
    return { status: 'dropped', dropped: state.droppedObservations };
  }
  state.observations.push(observation);
  return { status: 'enqueued', queued: state.observations.length };
}
