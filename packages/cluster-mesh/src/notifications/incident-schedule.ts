// Time-driven ops alert helpers for the host sweep (notify L1).
//
// The event-driven transitions live in `incident-policy.ts`; these helpers
// cover what happens with no new event: 24 h escalation, digest cadence,
// dead-man silence and the per-target send ceiling. Pure: `nowIso` injected.

import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  type OpsIncidentMailV1,
  type OpsIncidentStateV1,
  type OpsNotificationPolicyV1,
} from './incident-state.js';

/**
 * Time-driven mails for a firing incident with no new event (sweep path):
 * 24 h escalation, then the digest cadence. Returns the next state.
 */
export function dueOpsTimeDrivenMails(
  state: OpsIncidentStateV1,
  nowIso: string,
  policy: OpsNotificationPolicyV1 = DEFAULT_OPS_NOTIFICATION_POLICY_V1,
): { readonly state: OpsIncidentStateV1; readonly mails: readonly OpsIncidentMailV1[] } {
  if (state.status !== 'firing') return { state, mails: [] };
  if (state.escalationLevel === 0 && Date.parse(nowIso) - Date.parse(state.firstSeenAt) >= policy.escalateAfterFiringMs) {
    return {
      state: { ...state, escalationLevel: 1, lastEscalationAt: nowIso, lastMailAt: nowIso },
      mails: ['escalation'],
    };
  }
  if (state.lastMailAt !== null && Date.parse(nowIso) - Date.parse(state.lastMailAt) >= policy.digestEveryMs) {
    return { state: { ...state, lastMailAt: nowIso }, mails: ['digest'] };
  }
  return { state, mails: [] };
}

/** Dead-man check: silence past the grace with no firing incident opens `stale`. */
export function isOpsHeartbeatOverdue(
  lastHeartbeatAt: string | null,
  nowIso: string,
  policy: OpsNotificationPolicyV1 = DEFAULT_OPS_NOTIFICATION_POLICY_V1,
): boolean {
  if (lastHeartbeatAt === null) return false;
  return Date.parse(nowIso) - Date.parse(lastHeartbeatAt) >= policy.heartbeatGraceMs;
}

/** Host-side send ceiling: at most N mails per target in the trailing hour. */
export function isOpsMailCapExceeded(
  sentAtIso: readonly string[],
  nowIso: string,
  policy: OpsNotificationPolicyV1 = DEFAULT_OPS_NOTIFICATION_POLICY_V1,
): boolean {
  const hourAgo = Date.parse(nowIso) - 60 * 60 * 1000;
  return sentAtIso.filter((at) => Date.parse(at) > hourAgo).length >= policy.maxMailsPerHourPerTarget;
}
