import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  applyOpsJobFailureEvent,
  dueOpsTimeDrivenMails,
  isOpsHeartbeatOverdue,
  isOpsMailCapExceeded,
  openOpsStaleIncident,
  type OpsIncidentStateV1,
  type OpsJobFailureV1,
} from '../src/notifications/index.js';

const T0 = '2026-11-09T10:00:00.000Z';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const at = (ms: number): string => new Date(Date.parse(T0) + ms).toISOString();

const failed = (eventId: string, extra: Partial<OpsJobFailureV1> = {}): OpsJobFailureV1 => ({
  v: 1, eventId, source: 'k8s', targetKey: 'immo-prod',
  jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
  runId: eventId, outcome: 'failed', reason: 'job-failed', severity: 'warning',
  occurredAt: T0, ...extra,
});

const succeeded = (eventId: string): OpsJobFailureV1 => ({
  v: 1, eventId, source: 'k8s', targetKey: 'immo-prod',
  jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
  runId: eventId, outcome: 'succeeded', occurredAt: T0,
});

describe('ops incident state machine', () => {
  it('opens an incident with one firing mail and absorbs repeats silently', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-1:failed'), T0);
    expect(first.mails).toEqual(['firing']);
    expect(first.opened).toBe(true);
    expect(first.state?.occurrenceCount).toBe(1);
    const second = applyOpsJobFailureEvent(first.state, failed('k8s:run-2:failed'), at(5 * MIN));
    expect(second.mails).toEqual([]);
    expect(second.state?.occurrenceCount).toBe(2);
    expect(second.state?.consecutiveFailures).toBe(2);
  });

  it('escalates on the third consecutive failure', () => {
    let state: OpsIncidentStateV1 | null = null;
    let mails: readonly string[] = [];
    for (const run of ['run-1', 'run-2', 'run-3']) {
      const transition = applyOpsJobFailureEvent(state, failed(`k8s:${run}:failed`), at(5 * MIN));
      state = transition.state;
      mails = transition.mails;
    }
    expect(mails).toEqual(['escalation']);
    expect(state?.escalationLevel).toBe(1);
    const fourth = applyOpsJobFailureEvent(state, failed('k8s:run-4:failed'), at(10 * MIN));
    expect(fourth.mails).toEqual([]);
  });

  it('escalates at 24 h of firing, then digests every 24 h', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-1:failed'), T0);
    const escalated = applyOpsJobFailureEvent(first.state, failed('k8s:run-2:failed'), at(24 * HOUR + MIN));
    expect(escalated.mails).toEqual(['escalation']);
    const digest = applyOpsJobFailureEvent(escalated.state, failed('k8s:run-3:failed'), at(48 * HOUR + 2 * MIN));
    expect(digest.mails).toEqual(['digest']);
    const quiet = applyOpsJobFailureEvent(digest.state, failed('k8s:run-4:failed'), at(48 * HOUR + 3 * MIN));
    expect(quiet.mails).toEqual([]);
  });

  it('resolves on succeeded with a recovery mail and closes every reason class', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-1:failed', { reason: 'quota' }), T0);
    const resolved = applyOpsJobFailureEvent(first.state, succeeded('k8s:run-1:succeeded'), at(HOUR));
    expect(resolved.mails).toEqual(['recovery']);
    expect(resolved.state?.status).toBe('resolved');
    const replay = applyOpsJobFailureEvent(resolved.state, succeeded('k8s:run-1:succeeded'), at(2 * HOUR));
    expect(replay.mails).toEqual([]);
  });

  it('reopens without a firing mail inside the anti-flap window', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-1:failed'), T0);
    const resolved = applyOpsJobFailureEvent(first.state, succeeded('k8s:run-1:succeeded'), at(10 * MIN));
    const reopened = applyOpsJobFailureEvent(resolved.state, failed('k8s:run-2:failed'), at(20 * MIN));
    expect(reopened.reopened).toBe(true);
    expect(reopened.mails).toEqual([]);
    expect(reopened.state?.status).toBe('firing');
    const late = applyOpsJobFailureEvent(resolved.state, failed('k8s:run-3:failed'), at(2 * HOUR));
    expect(late.reopened).toBe(false);
    expect(late.opened).toBe(true);
    expect(late.mails).toEqual(['firing']);
  });

  it('escalates firing incidents older than 24 h without new events', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-1:failed'), T0);
    const due = dueOpsTimeDrivenMails(first.state!, at(24 * HOUR + MIN));
    expect(due.mails).toEqual(['escalation']);
    const digest = dueOpsTimeDrivenMails(due.state, at(48 * HOUR + 2 * MIN));
    expect(digest.mails).toEqual(['digest']);
  });

  it('watches heartbeats silently, opens dead-man stale, recovers on resume', () => {
    const heartbeat = (eventId: string, occurredAt: string = T0): OpsJobFailureV1 => ({
      v: 1, eventId, source: 'k8s', targetKey: 'immo-prod',
      jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
      runId: eventId, outcome: 'heartbeat', occurredAt,
    });
    const dormant = applyOpsJobFailureEvent(null, heartbeat('k8s:cron:schedule:1'), T0);
    expect(dormant.mails).toEqual([]);
    expect(dormant.state?.status).toBe('resolved');
    expect(dormant.state?.occurrenceCount).toBe(0);
    expect(isOpsHeartbeatOverdue(dormant.state?.lastHeartbeatAt ?? null, at(30 * MIN))).toBe(false);
    expect(isOpsHeartbeatOverdue(dormant.state?.lastHeartbeatAt ?? null, at(2 * HOUR))).toBe(true);
    const stale = openOpsStaleIncident('immo-prod', 'immo', 'radar-refresh-pv', 'CronJob', at(2 * HOUR));
    expect(stale.status).toBe('firing');
    expect(stale.lastReason).toBe('stale');
    const resumed = applyOpsJobFailureEvent(
      stale,
      heartbeat('k8s:cron:schedule:2', at(2 * HOUR + MIN)),
      at(2 * HOUR + MIN),
    );
    expect(resumed.mails).toEqual(['recovery']);
    expect(resumed.state?.status).toBe('resolved');
  });

  it('ignores a delayed failed that predates the recovery', () => {
    const first = applyOpsJobFailureEvent(null, failed('k8s:run-2:failed', { occurredAt: at(10 * MIN) }), at(10 * MIN));
    const resolved = applyOpsJobFailureEvent(
      first.state,
      { ...succeeded('k8s:run-2:succeeded'), occurredAt: at(20 * MIN) },
      at(20 * MIN),
    );
    expect(resolved.state?.status).toBe('resolved');
    const delayed = applyOpsJobFailureEvent(
      resolved.state,
      { ...failed('k8s:run-1:failed', { occurredAt: T0 }), runId: 'run-1' },
      at(30 * MIN),
    );
    expect(delayed.stale).toBe(true);
    expect(delayed.mails).toEqual([]);
    expect(delayed.state?.status).toBe('resolved');
  });

  it('ignores an old succeeded while firing and refreshes the watch on success', () => {
    const first = applyOpsJobFailureEvent(
      null, failed('k8s:run-2:failed', { occurredAt: at(10 * MIN) }), at(10 * MIN),
    );
    const oldSuccess = applyOpsJobFailureEvent(
      first.state,
      { ...succeeded('k8s:run-1:succeeded'), occurredAt: T0 },
      at(15 * MIN),
    );
    expect(oldSuccess.stale).toBe(true);
    expect(oldSuccess.state?.status).toBe('firing');
    const heartbeat = (eventId: string, occurredAt: string): OpsJobFailureV1 => ({
      v: 1, eventId, source: 'k8s', targetKey: 'immo-prod',
      jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
      runId: eventId, outcome: 'heartbeat', occurredAt,
    });
    const dormant = applyOpsJobFailureEvent(null, heartbeat('k8s:cron:schedule:1', T0), T0);
    const proven = applyOpsJobFailureEvent(
      dormant.state,
      { ...succeeded('k8s:run-9:succeeded'), occurredAt: at(30 * MIN) },
      at(30 * MIN),
    );
    expect(proven.mails).toEqual([]);
    expect(proven.state?.lastHeartbeatAt).toBe(at(30 * MIN));
    const oldBeat = applyOpsJobFailureEvent(
      proven.state,
      heartbeat('k8s:cron:schedule:0', T0),
      at(31 * MIN),
    );
    expect(oldBeat.stale).toBe(true);
    expect(oldBeat.state?.lastHeartbeatAt).toBe(at(30 * MIN));
  });

  it('caps sends at 10 mails per hour per target', () => {
    expect(DEFAULT_OPS_NOTIFICATION_POLICY_V1.maxMailsPerHourPerTarget).toBe(10);
    const sent = Array.from({ length: 10 }, (_, index) => at(index * MIN));
    expect(isOpsMailCapExceeded(sent, at(10 * MIN))).toBe(true);
    expect(isOpsMailCapExceeded(sent, at(2 * HOUR))).toBe(false);
  });
});
