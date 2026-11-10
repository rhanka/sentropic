import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPS_NOTIFICATION_POLICY_V1,
  type OpsIncidentStateV1,
} from '@sentropic/cluster-mesh/notifications';
import { OpsMailError } from '../../../src/services/notifications/ops-mail';
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
  lastDetail: null,
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
  failSend: null | 'transient' | 'permanent';
  sentMessageIds: string[];
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
      const row = world.incidents.get(key);
      if (row) world.incidents.set(key, { ...row, lastMailAt: sentAt });
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
    claimPendingDeliveries: async (_limit, nowIso) => {
      const rows = [...world.deliveries.values()].filter(
        (d) => d.status === 'pending' && (d.nextAttemptAt === null || d.nextAttemptAt <= nowIso),
      );
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
    saveIncidentWithDeliveries: async (state, deliveries) => {
      world.incidents.set(state.key, state);
      for (const input of deliveries) {
        const record = delivery({
          id: `d-${world.deliveries.size + 1}`, incidentId: input.incidentId,
          targetKey: input.targetKey, kind: input.kind, subject: input.subject,
          textBody: input.textBody, htmlBody: input.htmlBody, eventId: null,
        });
        world.deliveries.set(record.id, record);
      }
    },
    markDeliveryCapDelayed: async (id, error, nextAttemptAt) => {
      const row = world.deliveries.get(id)!;
      row.status = 'pending';
      row.lastError = error;
      row.nextAttemptAt = nextAttemptAt;
      row.attempts = Math.max(0, row.attempts - 1);
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
    countPendingForTarget: async (targetKey) =>
      [...world.deliveries.values()].filter(
        (row) => row.targetKey === targetKey && (row.status === 'pending' || row.status === 'sending'),
      ).length,
    reclaimStaleSending: async () => 0,
    purgeExpiredOpsData: async () => ({ deliveries: 0, seenEvents: 0 }),
    loadSeenEvent: async () => null,
    findSeenCanonical: async () => null,
    recordSeenEvent: async () => {},
    hasUnsentDelivery: async (incidentId, kind) =>
      [...world.deliveries.values()].some(
        (row) => row.incidentId === incidentId && row.kind === kind && (row.status === 'pending' || row.status === 'sending'),
      ),
  };
  return {
    store,
    mailer: {
      send: async (input: { to: string }) => {
        if (world.failSend === 'transient') throw new Error('socket hang up');
        if (world.failSend === 'permanent') {
          throw new OpsMailError('ops_mail_delivery_failed: HTTP 400 bad request', false, 400);
        }
        world.sent.push({ to: input.to });
        const id = `mid-${world.sentMessageIds.length + 1}`;
        world.sentMessageIds.push(id);
        return id;
      },
    },
    recipients: {
      listRecipientsForTarget: async () => [
        { accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod' },
      ],
    },
    configRecipients: {
      listRecipientsForTarget: async () => [
        { accountId: 'u-platform', email: 'platform@example.com', basis: 'platform-admin-fallback' },
      ],
    },
    clock: () => world.clock,
    policy: DEFAULT_OPS_NOTIFICATION_POLICY_V1,
    withIncidentLock: async <T>(_: string, work: () => Promise<T>): Promise<T> => work(),
    withTargetLock: async <T>(_: string, work: () => Promise<T>): Promise<T> => work(),
    withGlobalLock: async <T>(_: string, work: () => Promise<T>): Promise<T> => work(),
  };
};

const world = (extra: Partial<FakeWorld> = {}): FakeWorld => ({
  incidents: new Map(), deliveries: new Map(), sent: [],
  failSend: null, sentMessageIds: [], clock: iso(0), ...extra,
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
      { accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod', messageId: 'mid-1' },
    ]);
    expect(w.incidents.get('immo-prod/immo/radar-refresh-pv')!.lastMailAt).toBe(w.clock);
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

  it('requeues cap-hit deliveries with a backoff instead of dropping them', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    for (let index = 0; index < 10; index += 1) {
      w.deliveries.set(`sent-${index}`, delivery({
        id: `sent-${index}`, status: 'sent', sentAt: iso(30 * 60 * 1000),
        recipients: [{ accountId: 'u-1', email: 'admin@example.com', basis: 'x', messageId: 'm' }],
      }));
    }
    w.deliveries.set('d-1', delivery());
    const capped = await runOpsNotificationSweep(fakeDeps(w));
    expect(capped.suppressed).toBe(1);
    expect(capped.sent).toBe(0);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'pending' });
    expect(w.deliveries.get('d-1')!.nextAttemptAt).not.toBeNull();
  });

  it('caps the batch itself: 100 recipients from zero send 10 and defer the rest', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery({ attempts: 1 }));
    const many = Array.from({ length: 100 }, (_, index) => ({
      accountId: `u-${index}`, email: `admin-${index}@example.com`, basis: 'platform-declaration:immo-prod',
    }));
    const deps = {
      ...fakeDeps(w),
      recipients: { listRecipientsForTarget: async () => many },
    };
    const result = await runOpsNotificationSweep(deps);
    expect(result.suppressed).toBe(1);
    expect(result.sent).toBe(0);
    expect(w.sent).toHaveLength(10);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'pending' });
    expect(w.deliveries.get('d-1')!.recipients).toHaveLength(10);
    expect(w.deliveries.get('d-1')!.nextAttemptAt).not.toBeNull();
  });

  it('does not consume the retry budget on a cap deferral', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery({ attempts: 1 }));
    const many = Array.from({ length: 100 }, (_, index) => ({
      accountId: `u-${index}`, email: `cap-${index}@example.com`, basis: 'platform-declaration:immo-prod',
    }));
    const deps = {
      ...fakeDeps(w),
      recipients: { listRecipientsForTarget: async () => many },
    };
    await runOpsNotificationSweep(deps);
    expect(w.deliveries.get('d-1')!.attempts).toBe(1);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'pending' });
  });

  it('persists time-driven state and mails in one atomic store call', async () => {
    const w = world({
      incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]),
      clock: iso(24 * HOUR + 1000),
    });
    const deps = fakeDeps(w);
    const atomic = vi.spyOn(deps.store, 'saveIncidentWithDeliveries');
    const direct = vi.spyOn(deps.store, 'saveIncident');
    const result = await runOpsNotificationSweep(deps);
    expect(result.timeDriven).toBe(1);
    expect(atomic).toHaveBeenCalledTimes(1);
    expect(direct).not.toHaveBeenCalled();
  });

  it('purges 90-day audit trail best-effort without blocking sends', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery());
    const deps = fakeDeps(w);
    const purge = vi.spyOn(deps.store, 'purgeExpiredOpsData');
    const result = await runOpsNotificationSweep(deps);
    expect(result.sent).toBe(1);
    expect(purge).toHaveBeenCalledTimes(1);
    const cutoff = Date.parse(purge.mock.calls[0]![0]!);
    expect(new Date(w.clock).getTime() - cutoff).toBe(90 * 24 * 60 * 60 * 1000);

    const w2 = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w2.deliveries.set('d-1', delivery());
    const failing = fakeDeps(w2);
    failing.store.purgeExpiredOpsData = async () => { throw new Error('db down'); };
    const resumed = await runOpsNotificationSweep(failing);
    expect(resumed.sent).toBe(1);
  });

  it('retries transient TEM errors with a backoff and fails permanent ones', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]), failSend: 'transient' });
    w.deliveries.set('d-1', delivery());
    const retried = await runOpsNotificationSweep(fakeDeps(w));
    expect(retried.failed).toBe(1);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'pending' });
    expect(w.deliveries.get('d-1')!.nextAttemptAt).not.toBeNull();

    const w2 = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]), failSend: 'permanent' });
    w2.deliveries.set('d-1', delivery());
    const failed = await runOpsNotificationSweep(fakeDeps(w2));
    expect(failed.failed).toBe(1);
    expect(w2.deliveries.get('d-1')).toMatchObject({ status: 'failed' });
  });

  it('fails a delivery past the attempt ceiling instead of retrying forever', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery({ attempts: 99 }));
    const result = await runOpsNotificationSweep(fakeDeps(w));
    expect(result.failed).toBe(1);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'failed' });
  });

  it('resumes a crashed multi-recipient send without resending served addresses', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery({
      recipients: [{ accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod', messageId: 'mid-old' }],
    }));
    const deps = {
      ...fakeDeps(w),
      recipients: {
        listRecipientsForTarget: async () => [
          { accountId: 'u-1', email: 'admin@example.com', basis: 'platform-declaration:immo-prod' },
          { accountId: 'u-2', email: 'second@example.com', basis: 'platform-declaration:immo-prod' },
        ],
      },
    };
    const result = await runOpsNotificationSweep(deps);
    expect(result.sent).toBe(1);
    expect(w.sent).toEqual([{ to: 'second@example.com' }]);
    expect(w.deliveries.get('d-1')!.recipients).toHaveLength(2);
  });

  it('requeues the original when the config port itself fails', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery());
    const deps = {
      ...fakeDeps(w),
      recipients: { listRecipientsForTarget: async () => [] as const },
      configRecipients: { listRecipientsForTarget: async () => { throw new Error('idp down'); } },
    };
    const result = await runOpsNotificationSweep(deps);
    expect(result.failed).toBe(1);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'pending' });
    expect([...w.deliveries.values()].filter((row) => row.kind === 'config')).toHaveLength(0);
  });

  it('fails closed with a config alert when the target has no usable recipient', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery());
    const deps = { ...fakeDeps(w), recipients: { listRecipientsForTarget: async () => [] as const } };
    const result = await runOpsNotificationSweep(deps);
    expect(result.failed).toBe(1);
    expect(w.deliveries.get('d-1')!.lastError).toContain('no usable recipient');
    expect(w.sent).toHaveLength(0);
    const config = [...w.deliveries.values()].find((row) => row.kind === 'config');
    expect(config).toBeDefined();
    expect(config).toMatchObject({ status: 'pending', targetKey: 'immo-prod' });
    expect(result.configAlerts).toBe(1);
  });

  it('delivers the config alert to the platform admins on the next sweep', async () => {
    const w = world({ incidents: new Map([['immo-prod/immo/radar-refresh-pv', incident()]]) });
    w.deliveries.set('d-1', delivery({ id: 'd-1', kind: 'config', subject: 'config' }));
    const deps = { ...fakeDeps(w), recipients: { listRecipientsForTarget: async () => [] as const } };
    const result = await runOpsNotificationSweep(deps);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);
    expect(w.sent).toEqual([{ to: 'platform@example.com' }]);
    expect(w.deliveries.get('d-1')).toMatchObject({ status: 'sent' });
    expect(w.deliveries.get('d-1')!.recipients).toEqual([
      { accountId: 'u-platform', email: 'platform@example.com', basis: 'platform-admin-fallback', messageId: 'mid-1' },
    ]);
  });
});
