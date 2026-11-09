// Ops incident state and constructors (notify L1).
//
// One incident per (targetKey, namespace, job name). Event-driven
// transitions live in `incident-policy.ts`; time-driven sweep helpers in
// `incident-schedule.ts`.

import type { OpsJobFailureReasonV1, OpsJobFailureSeverityV1, OpsJobFailureV1, OpsJobKindV1 } from './ops-job-failure-types.js';

export type OpsIncidentStatusV1 = 'firing' | 'resolved';

/** Alert mails the machine can request for one applied event. */
export type OpsIncidentMailV1 = 'firing' | 'escalation' | 'digest' | 'recovery';

export interface OpsIncidentStateV1 {
  readonly key: string;
  readonly targetKey: string;
  readonly jobNamespace: string | null;
  readonly jobName: string;
  readonly jobKind: OpsJobKindV1;
  readonly status: OpsIncidentStatusV1;
  readonly firstSeenAt: string;
  readonly lastSeenAt: string;
  readonly occurrenceCount: number;
  readonly consecutiveFailures: number;
  readonly lastReason: OpsJobFailureReasonV1 | null;
  readonly lastSeverity: OpsJobFailureSeverityV1 | null;
  readonly lastRunId: string | null;
  readonly lastEventId: string;
  readonly lastLinks: { readonly logs?: string; readonly run?: string } | null;
  /** Any alert mail (firing/escalation/digest/recovery) resets the digest clock. */
  readonly lastMailAt: string | null;
  readonly escalationLevel: 0 | 1;
  readonly lastEscalationAt: string | null;
  readonly resolvedAt: string | null;
  readonly lastHeartbeatAt: string | null;
}

export interface OpsNotificationPolicyV1 {
  /** Consecutive failures promoting the incident to critical. */
  readonly escalateAfterConsecutiveFailures: number;
  /** Firing age promoting the incident to critical. */
  readonly escalateAfterFiringMs: number;
  /** Quiet period between digest mails while firing. */
  readonly digestEveryMs: number;
  /** Hard per-target send ceiling enforced by the host at send time. */
  readonly maxMailsPerHourPerTarget: number;
  /** Reopen window after a resolve: same incident, no new firing mail. */
  readonly flapWindowMs: number;
  /** Silence after the last heartbeat that opens a dead-man (`stale`) incident. */
  readonly heartbeatGraceMs: number;
}

export const DEFAULT_OPS_NOTIFICATION_POLICY_V1: OpsNotificationPolicyV1 = {
  escalateAfterConsecutiveFailures: 3,
  escalateAfterFiringMs: 24 * 60 * 60 * 1000,
  digestEveryMs: 24 * 60 * 60 * 1000,
  maxMailsPerHourPerTarget: 10,
  flapWindowMs: 60 * 60 * 1000,
  heartbeatGraceMs: 60 * 60 * 1000,
};

export interface OpsIncidentTransitionV1 {
  readonly state: OpsIncidentStateV1 | null;
  readonly mails: readonly OpsIncidentMailV1[];
  readonly opened: boolean;
  readonly reopened: boolean;
}

function baseIncident(
  event: OpsJobFailureV1,
  nowIso: string,
  status: OpsIncidentStatusV1,
): OpsIncidentStateV1 {
  const namespace = event.jobRef.namespace ?? null;
  return {
    key: `${event.targetKey}/${namespace ?? ''}/${event.jobRef.name}`,
    targetKey: event.targetKey, jobNamespace: namespace, jobName: event.jobRef.name, jobKind: event.jobRef.kind,
    status, firstSeenAt: nowIso, lastSeenAt: nowIso,
    occurrenceCount: 0, consecutiveFailures: 0,
    lastReason: null, lastSeverity: null, lastRunId: null, lastEventId: event.eventId,
    lastLinks: null, lastMailAt: null,
    escalationLevel: 0, lastEscalationAt: null, resolvedAt: null,
    lastHeartbeatAt: null,
  };
}

/** A `failed` event opens a firing incident and requests the firing mail. */
export function openIncident(event: OpsJobFailureV1, nowIso: string): OpsIncidentStateV1 {
  return {
    ...baseIncident(event, nowIso, 'firing'),
    occurrenceCount: 1, consecutiveFailures: 1,
    lastReason: event.reason ?? null, lastSeverity: event.severity ?? null,
    lastRunId: event.runId, lastLinks: event.links ?? null, lastMailAt: nowIso,
  };
}

/** Dormant watch record for a jobRef seen only through heartbeats. No mail. */
export function openDormantWatch(event: OpsJobFailureV1, nowIso: string): OpsIncidentStateV1 {
  return { ...baseIncident(event, nowIso, 'resolved'), lastHeartbeatAt: nowIso };
}

/**
 * Dead-man incident: the sweep opens it when a watched jobRef goes silent
 * past the heartbeat grace with no firing incident. The falsy `stale` reason
 * is the only reason a heartbeat can later resolve.
 */
export function openOpsStaleIncident(
  targetKey: string,
  jobNamespace: string | null,
  jobName: string,
  jobKind: OpsJobKindV1,
  nowIso: string,
): OpsIncidentStateV1 {
  return {
    key: `${targetKey}/${jobNamespace ?? ''}/${jobName}`,
    targetKey, jobNamespace, jobName, jobKind,
    status: 'firing', firstSeenAt: nowIso, lastSeenAt: nowIso,
    occurrenceCount: 1, consecutiveFailures: 0,
    lastReason: 'stale', lastSeverity: null, lastRunId: null, lastEventId: `dead-man:${nowIso}`,
    lastLinks: null, lastMailAt: nowIso,
    escalationLevel: 0, lastEscalationAt: null, resolvedAt: null,
    lastHeartbeatAt: null,
  };
}
