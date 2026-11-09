// Pure event-driven ops incident transitions (notify L1).
//
// Applies one validated event to the incident (or none) and decides WHICH
// mail to send. A `succeeded` resolves every open reason class of the same
// jobRef; a resumed heartbeat resolves a `stale` incident. No clock, no I/O.

import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  openDormantWatch,
  openIncident,
  type OpsIncidentStateV1,
  type OpsIncidentTransitionV1,
  type OpsJobFailureV1,
  type OpsNotificationPolicyV1,
} from './incident-state.js';

export type {
  OpsIncidentMailV1,
  OpsIncidentStateV1,
  OpsIncidentStatusV1,
  OpsIncidentTransitionV1,
  OpsNotificationPolicyV1,
} from './incident-state.js';
export { DEFAULT_OPS_NOTIFICATION_POLICY_V1, openOpsStaleIncident } from './incident-state.js';

export function applyOpsJobFailureEvent(
  state: OpsIncidentStateV1 | null,
  event: OpsJobFailureV1,
  nowIso: string,
  policy: OpsNotificationPolicyV1 = DEFAULT_OPS_NOTIFICATION_POLICY_V1,
): OpsIncidentTransitionV1 {
  if (event.outcome === 'heartbeat') {
    if (state === null) return { state: openDormantWatch(event, nowIso), mails: [], opened: false, reopened: false };
    if (state.status === 'resolved') {
      return { state: { ...state, lastSeenAt: nowIso, lastHeartbeatAt: nowIso }, mails: [], opened: false, reopened: false };
    }
    if (state.lastReason === 'stale') {
      return {
        state: {
          ...state, status: 'resolved', resolvedAt: nowIso, consecutiveFailures: 0,
          lastHeartbeatAt: nowIso, lastSeenAt: nowIso, lastMailAt: nowIso,
        },
        mails: ['recovery'], opened: false, reopened: false,
      };
    }
    return { state: { ...state, lastHeartbeatAt: nowIso, lastSeenAt: nowIso }, mails: [], opened: false, reopened: false };
  }
  if (event.outcome === 'succeeded') {
    if (state === null || state.status === 'resolved') return { state, mails: [], opened: false, reopened: false };
    return {
      state: {
        ...state, status: 'resolved', resolvedAt: nowIso, consecutiveFailures: 0,
        lastRunId: event.runId, lastEventId: event.eventId, lastMailAt: nowIso,
      },
      mails: ['recovery'], opened: false, reopened: false,
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
        },
        mails: [], opened: false, reopened: true,
      };
    }
    // A dormant heartbeat watch becomes a real incident but keeps its watch.
    return {
      state: state === null
        ? openIncident(event, nowIso)
        : { ...openIncident(event, nowIso), lastHeartbeatAt: state.lastHeartbeatAt },
      mails: ['firing'], opened: true, reopened: false,
    };
  }
  const consecutiveFailures = state.consecutiveFailures + 1;
  const firingMs = Date.parse(nowIso) - Date.parse(state.firstSeenAt);
  const next = {
    ...state, lastSeenAt: nowIso,
    occurrenceCount: state.occurrenceCount + 1, consecutiveFailures,
    lastReason: event.reason ?? state.lastReason, lastSeverity: event.severity ?? state.lastSeverity,
    lastRunId: event.runId, lastEventId: event.eventId, lastLinks: event.links ?? state.lastLinks,
  };
  if (state.escalationLevel === 0
    && (consecutiveFailures >= policy.escalateAfterConsecutiveFailures || firingMs >= policy.escalateAfterFiringMs)) {
    return {
      state: { ...next, escalationLevel: 1, lastEscalationAt: nowIso, lastMailAt: nowIso },
      mails: ['escalation'], opened: false, reopened: false,
    };
  }
  const lastMailMs = state.lastMailAt === null ? firingMs : Date.parse(nowIso) - Date.parse(state.lastMailAt);
  if (lastMailMs >= policy.digestEveryMs) {
    return { state: { ...next, lastMailAt: nowIso }, mails: ['digest'], opened: false, reopened: false };
  }
  return { state: next, mails: [], opened: false, reopened: false };
}
