import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  type OpsIncidentStateV1,
} from '@sentropic/cluster-mesh/notifications';
import { runOpsNotificationSweep } from '../../../src/services/notifications/ops-sweep';
import type {
  OpsDeliveryRecordV1,
  OpsNotificationStorePort,
} from '../../../src/services/notifications/ops-types';

const T0 = Date.parse('2026-11-09T10:00:00.000Z');
const iso = (ms: number): string => new Date(T0 + ms).toISOString();
const HOUR = 60 * 60 * 1000;

const incident = (extra: Partial<OpsIncidentStateV1> = {}): OpsIncidentStateV1 => ({
  key: 'immo-prod/immo/radar-refresh-pv',
  targetKey: 'immo-prod',
  jobNamespace: 'immo',
  jobName: 'radar-refresh-pv',
  jobKind: 'CronJob',
  status: 'firing',
  firstSeenAt: iso(0),
  lastSeenAt: iso(0),
  occurrenceCount: 1,
  consecutiveFailures: 1,
  lastReason: 'job-failed',
  lastSeverity: 'warning',
  lastRunId: 'run-1',
  lastEventId: 'k8s:run-1:failed',
  lastLinks: null,
  lastMailAt: iso(0),
  escalationLevel: 0,
  lastEscalationAt: null,
  resolvedAt: null,
  lastHeartbeatAt: null,
  lastOccurredAt: iso(0),
  ...extra,
});

const delivery = (extra: Partial<OpsDeliveryRecordV1> = {}): OpsDeliveryRecordV1 => ({
  id: 'd-1', incidentId: 'immo-prod/immo/radar-refresh-pv', targetKey: 'immo-prod',
  kind: 'firing', status: 'pending', subject: 's', textBody: 't', htmlBody: '<p>t</p>',
  recipients: [], eventId: null, attempts: 1, lastError: null, messageId: null, sentAt: null,
  nextAttemptAt: null,
  ...extra,
});

interface FakeWorld {
  incidents: Map<string, OpsIncidentStateV1>;
  deliveries: Map<string, OpsDeliveryRecordV1>;
  sent: { to: string }[];
  failSend: boolean;
  clock: string;
}

const fakeDeps = (world: FakeWorld) => {
  const store: OpsNotificationStorePort = {
    loadIncident: async (key) => world.incidents.get(key) ?? null,
    saveIncident: async (state) => { world.incidents.set(state.key, state); },
    listFiringIncidents: async () => [...world.incidents.values()].filter((i) => i.status === 'firing'),
    listHeartbeatWatches: async () =>
      [...world.incidents.values()].filter((i) => i.status === 'resolved' && i.lastHeartbeatAt !== null),
    touchIncidentMailAt: async (key, sentAt) => {
      const incident = world.incidents.get(key);
      if (incident) world.incidents.set(key, { ...incident, lastMailAt: sentAt });
    },
    insertDelivery: async (input) => {
      const record = delivery({
        id: `d-${world.deliveries.size + 1}`, incidentId: input.incidentId,
        targetKey: input.targetKey, kind: input.kind, subject: input.subject,
        textBody: input.textBody, htmlBody: input.htmlBody, eventId: input.eventId ?? null,
      });
      world.deliveries.set(record.id, record);
      return record;
    },
    claimPendingDeliveries: async () => {
      const rows = [...world.deliveries.values()].filter((d) => d.status === 'pending');
      for (const row of rows) {
        row.status = 'sending';
        row.attempts += 1;
      }
      return rows;
    },
    markDeliverySent: async (id, messageId, recipients, sentAt) => {
      const row = world.deliveries.get(id)!;
      row.status = 'sent';
      row.messageId = messageId;
      row.recipients = [...recipients];
      row.sentAt = sentAt;
      row.nextAttemptAt = null;
    },
    markDeliveryRecipientSent: async (id, recipient) => {
      const row = world.deliveries.get(id)!;
      if (!row.recipients.some((entry) => entry.email === recipient.email)) {
        row.recipients = [...row.recipients, recipient];
      }
    },
    markDeliveryFailed: async (id, error) => {
      world.deliveries.get(id)!.status = 'failed';
      world.deliveries.get(id)!.lastError = error;
    },
    markDeliveryRetryable: async (id, error, nextAttemptAt) => {
      const row = world.deliveries.get(id)!;
      row.status = 'pending';
      row.lastError = error;
      row.nextAttemptAt = nextAttemptAt;
    },
    listRecentSentMailCounts: async () => {
      const counts = new Map<string, number>();
      for (const row of world.deliveries.values()) {
        if (row.status !== 'sent') continue;
        counts.set(row.targetKey, (counts.get(row.targetKey) ?? 0) + row.recipients.length);
      }
      return [...counts.entries()].map(([targetKey, mails]) => ({ targetKey, mails }));
    },
    countRecentSentTo: async (email) =>
      [...world.deliveries.values()].filter(
        (row) => row.status === 'sent' && row.recipients.some((entry) => entry.email === email),
      ).length,
    reclaimStaleSending: async () => 0,
    loadSeenEvent: async () => null,
    findSeenCanonical: async () => null,
    recordSeenEvent: async () => {},
    markDeliverySuppressed: async (id) => { world.deliveries.get(id)!.status = 'suppressed'; },
    listRecentSentAt: async () =>
      [...world.deliveries.values()].filter((d) => d.status === 'sent').map((d) => d.sentAt ?? iso(0)),
  };
  return {
    store,
    mailer: {
      send: async (input: { to: string }) => {
        if (world.failSend) throw new Error('ops_mail_delivery_failed');
        world.sent.push({ to: input.to });
        return 'mid-1';
      },
    },
    recipients: {
      listRecipientsForTarget: async () => [
        { accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod' },
      ],
    },
    clock: () => world.clock,
    policy: DEFAULT_OPS_NOTIFICATION_POLICY_V1,
    withIncidentLock: async <T>(_: string, work: () => Promise<T>): Promise<T> => work(),
  };
};

const world = (extra: Partial<FakeWorld> = {}): FakeWorld => ({
  incidents: new Map(), deliveries: new Map(), sent: [], failSend: false, clock: iso(0), ...extra,
});

describe('runOpsNotificationSweep', () => {
  it('sends a queued firing delivery to the live recipients and audits it', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery());
    const result = await runOpsNotificationSweep(fakeDeps(w));
    expect(result.sent).toBe(1);
    expect(w.sent).toEqual([{ to: 'admin@example.com' }]);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'sent', messageId: 'mid-1' });
    expect(w.deliveries.get('d-1')!.recipients).toEqual([
      { accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod' },
    ]);
  });

  it('creates the 24 h escalation delivery for a firing incident with no new event', async () => {
    const w = world({
      incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]),
      clock: iso(24 * HOUR + 1000),
    });
    const result = await runOpsNotificationSweep(fakeDeps(w));
    expect(result.timeDriven).toBe(1);
    expect([...w.deliveries.values()]).toHaveLength(1);
    expect([...w.deliveries.values()][0]).toMatchObject({ kind: 'escalation' });
    expect(w.incidents.get('immo-prod/immo/radar-refresh-pv')!.escalationLevel).toBe(1);
  });

  it('opens then sends a dead-man incident for a silent watch', async () => {
    const watch = incident({
      key: 'immo-prod/immo/nightly', jobName: 'nightly', status: 'resolved',
      occurrenceCount: 0, consecutiveFailures: 0, lastReason: null, lastMailAt: null,
      resolvedAt: null, lastHeartbeatAt: iso(0),
    });
    const w = world({ incidents: new Map([[watch.key, watch]]), clock: iso(2 * HOUR) });
    const result = await runOpsNotificationSweep(fakeDeps(w));
    expect(result.deadMan).toBe(1);
    expect(w.incidents.get(watch.key)).toMatchObject({ status: 'firing', lastReason: 'stale' });
    expect(result.sent).toBe(1);
  });

  it('suppresses sends past the hourly per-target cap and fails visibly on TEM errors', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    for (let index = 0; index < 10; index += 1) {
      w.deliveries.set(`sent-${index}`, delivery({
        id: `sent-${index}`, status: 'sent', sentAt: iso(30 * 60 * 1000),
      }));
    }
    w.deliveries.set('d-1', delivery());
    const capped = await runOpsNotificationSweep(fakeDeps(w));
    expect(capped.suppressed).toBe(1);
    expect(w.sent).toHaveLength(0);

    const w2 = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]), failSend: true });
    w2.deliveries.set('d-1', delivery());
    const failed = await runOpsNotificationSweep(fakeDeps(w2));
    expect(failed.failed).toBe(1);
    expect(w2.deliveries.get('d-1')).toMatchObject({ status: 'failed' });
  });

  it('marks deliveries with no usable recipient as failed, never silently', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery());
    const deps = { ...fakeDeps(w), recipients: { listRecipientsForTarget: async () => [] as const } };
    const result = await runOpsNotificationSweep(deps);
    expect(result.failed).toBe(1);
    expect(w.deliveries.get('d-1')!.lastError).toContain('no usable recipient');
    expect(w.sent).toHaveLength(0);
  });
});
