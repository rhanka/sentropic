// Pure event-driven ops incident transitions (notify L1).
//
// Applies one validated event to the incident (or none) and decides WHICH
// mail to send. A `succeeded` resolves every open reason class of the same
// jobRef; a resumed heartbeat resolves a `stale` incident. Events older than
// the incident's newest applied emitter clock are stale replays: ignored, so
// a delayed `failed` can never reopen a recovered incident and an old
// `succeeded` can never resolve the current firing. No clock, no I/O.

import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  isOpsStaleEvent,
  openDormantWatch,
  openIncident,
  type OpsIncidentStateV1,
  type OpsIncidentTransitionV1,
  type OpsNotificationPolicyV1,
} from './incident-state.js';
import type { OpsJobFailureV1 } from './ops-job-failure-types.js';

export type {
  OpsIncidentMailV1,
  OpsIncidentStateV1,
  OpsIncidentStatusV1,
  OpsIncidentTransitionV1,
  OpsNotificationPolicyV1,
} from './incident-state.js';
export { DEFAULT_OPS_NOTIFICATION_POLICY_V1, isOpsStaleEvent, openOpsStaleIncident } from './incident-state.js';

const noChange = (state: OpsIncidentStateV1 | null): OpsIncidentTransitionV1 => ({
  state, mails: [], opened: false, reopened: false, stale: false,
});

const staleReplay = (state: OpsIncidentStateV1 | null): OpsIncidentTransitionV1 => ({
  state, mails: [], opened: false, reopened: false, stale: true,
});

export function applyOpsJobFailureEvent(
  state: OpsIncidentStateV1 | null,
  event: OpsJobFailureV1,
  nowIso: string,
  policy: OpsNotificationPolicyV1 = DEFAULT_OPS_NOTIFICATION_POLICY_V1,
): OpsIncidentTransitionV1 {
  if (isOpsStaleEvent(state, event.occurredAt)) return staleReplay(state);
  if (event.outcome === 'heartbeat') {
    if (state === null) return { state: openDormantWatch(event, nowIso), mails: [], opened: false, reopened: false, stale: false };
    if (state.status === 'resolved') {
      return {
        state: { ...state, lastSeenAt: nowIso, lastHeartbeatAt: nowIso, lastOccurredAt: event.occurredAt },
        mails: [], opened: false, reopened: false, stale: false,
      };
    }
    if (state.lastReason === 'stale') {
      return {
        state: {
          ...state, status: 'resolved', resolvedAt: nowIso, consecutiveFailures: 0,
          lastHeartbeatAt: nowIso, lastSeenAt: nowIso, lastMailAt: nowIso, lastOccurredAt: event.occurredAt,
        },
        mails: ['recovery'], opened: false, reopened: false, stale: false,
      };
    }
    return {
      state: { ...state, lastHeartbeatAt: nowIso, lastSeenAt: nowIso, lastOccurredAt: event.occurredAt },
      mails: [], opened: false, reopened: false, stale: false,
    };
  }
  if (event.outcome === 'succeeded') {
    if (state === null) return noChange(state);
    if (state.status === 'resolved') {
      // A success proves liveness: refresh the dormant watch so the dead-man
      // sweep cannot false-positive on a heartbeat that predates the run.
      return {
        state: {
          ...state, lastSeenAt: nowIso, lastHeartbeatAt: nowIso,
          lastRunId: event.runId, lastEventId: event.eventId, lastOccurredAt: event.occurredAt,
        },
        mails: [], opened: false, reopened: false, stale: false,
      };
    }
    return {
      state: {
        ...state, status: 'resolved', resolvedAt: nowIso, consecutiveFailures: 0,
        lastRunId: event.runId, lastEventId: event.eventId, lastMailAt: nowIso,
        lastHeartbeatAt: nowIso, lastOccurredAt: event.occurredAt,
      },
      mails: ['recovery'], opened: false, reopened: false, stale: false,
    };
  }
  if (state === null || state.status === 'resolved') {
    const reopened = state !== null
      && state.resolvedAt !== null
      && Date.parse(nowIso) - Date.parse(state.resolvedAt) < policy.flapWindowMs;
    if (reopened) {
      return {
        state: {
          ...state, status: 'firing', lastSeenAt: nowIso,
          occurrenceCount: state.occurrenceCount + 1, consecutiveFailures: state.consecutiveFailures + 1,
          lastReason: event.reason ?? state.lastReason, lastSeverity: event.severity ?? state.lastSeverity,
          lastRunId: event.runId, lastEventId: event.eventId, lastLinks: event.links ?? state.lastLinks,
          escalationLevel: 0, lastEscalationAt: null, resolvedAt: null,
          lastOccurredAt: event.occurredAt,
        },
        mails: [], opened: false, reopened: true, stale: false,
      };
    }
    // A dormant heartbeat watch becomes a real incident but keeps its watch.
    return {
      state: state === null
        ? openIncident(event, nowIso)
        : { ...openIncident(event, nowIso), lastHeartbeatAt: state.lastHeartbeatAt },
      mails: ['firing'], opened: true, reopened: false, stale: false,
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const firingMs = Date.parse(nowIso) - Date.parse(state.firstSeenAt);
  const next = {
    ...state, lastSeenAt: nowIso,
    occurrenceCount: state.occurrenceCount + 1, consecutiveFailures,
    lastReason: event.reason ?? state.lastReason, lastSeverity: event.severity ?? state.lastSeverity,
    lastRunId: event.runId, lastEventId: event.eventId, lastLinks: event.links ?? state.lastLinks,
    lastOccurredAt: event.occurredAt,
  };
  if (state.escalationLevel === 0
    && (consecutiveFailures >= policy.escalateAfterConsecutiveFailures || firingMs >= policy.escalateAfterFiringMs)) {
    return {
      state: { ...next, escalationLevel: 1, lastEscalationAt: nowIso, lastMailAt: nowIso },
      mails: ['escalation'], opened: false, reopened: false, stale: false,
    };
  }
  const lastMailMs = state.lastMailAt === null ? firingMs : Date.parse(nowIso) - Date.parse(state.lastMailAt);
  if (lastMailMs >= policy.digestEveryMs) {
    return { state: { ...next, lastMailAt: nowIso }, mails: ['digest'], opened: false, reopened: false, stale: false };
  }
  return { state: next, mails: [], opened: false, reopened: false, stale: false };
}
