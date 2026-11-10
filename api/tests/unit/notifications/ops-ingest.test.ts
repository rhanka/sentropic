import { describe, expect, it, vi } from 'vitest';
import type {
  OpsIncidentStateV1,
  OpsJobFailureV1,
} from '@sentropic/cluster-mesh/notifications';
import {
  OPS_INCIDENT_AGGREGATE_TYPE,
  ingestOpsJobFailureEvent,
} from '../../../src/services/notifications/ops-ingest';
import type {
  OpsDeliveryRecordV1,
  OpsNotificationStorePort,
  OpsOutboxPort,
  OpsSeenEventV1,
} from '../../../src/services/notifications/ops-types';

const T0 = '2026-11-09T10:00:00.000Z';

const failed = (eventId: string, extra: Partial<OpsJobFailureV1> = {}): OpsJobFailureV1 => ({
  v: 1, eventId, source: 'k8s', targetKey: 'immo-prod',
  jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
  runId: eventId, outcome: 'failed', reason: 'job-failed', severity: 'warning',
  occurredAt: T0, ...extra,
});

const fakeStore = (): OpsNotificationStorePort & {
  incidents: Map<string, OpsIncidentStateV1>;
  deliveries: OpsDeliveryRecordV1[];
  seen: Map<string, OpsSeenEventV1>;
  outbox: unknown[];
} => {
  const incidents = new Map<string, OpsIncidentStateV1>();
  const deliveries: OpsDeliveryRecordV1[] = [];
  const seen = new Map<string, OpsSeenEventV1>();
  let seq = 0;
  return {
    incidents, deliveries, seen, outbox: [],
    loadIncident: async (key) => incidents.get(key) ?? null,
    saveIncident: async (state) => { incidents.set(state.key, state); },
    listFiringIncidents: async () => [...incidents.values()].filter((i) => i.status === 'firing'),
    listHeartbeatWatches: async () => [...incidents.values()].filter((i) => i.status === 'resolved' && i.lastHeartbeatAt !== null),
    touchIncidentMailAt: async () => {},
    insertDelivery: async (input) => {
      seq += 1;
      const record: OpsDeliveryRecordV1 = {
        id: `d-${seq}`, incidentId: input.incidentId, targetKey: input.targetKey, kind: input.kind,
        status: 'pending', subject: input.subject, textBody: input.textBody, htmlBody: input.htmlBody,
        recipients: [], eventId: input.eventId ?? null, attempts: 0, lastError: null,
        messageId: null, sentAt: null, nextAttemptAt: null,
      };
      deliveries.push(record);
      return record;
    },
    claimPendingDeliveries: async () => [],
    markDeliverySent: async () => {},
    markDeliveryRecipientSent: async () => {},
    markDeliveryFailed: async () => {},
    markDeliveryRetryable: async () => {},
    listRecentSentMailCounts: async () => [],
    countRecentSentTo: async () => 0,
    loadSeenEvent: async (eventId) => seen.get(eventId) ?? null,
    hasUnsentDelivery: async () => false,
    findSeenCanonical: async (canonicalKey) =>
      [...seen.values()].find((row) => row.canonicalKey === canonicalKey) ?? null,
    recordSeenEvent: async (input) => {
      if (!seen.has(input.eventId)) seen.set(input.eventId, { ...input });
    },
  };
};

const fakeOutbox = (): OpsOutboxPort & { rows: unknown[] } => {
  const rows: unknown[] = [];
  return { rows, append: async (input) => { rows.push(input); } };
};

describe('ingestOpsJobFailureEvent', () => {
  it('opens an incident, queues a firing delivery and appends the outbox trace', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const result = await ingestOpsJobFailureEvent(
      { store, outbox, clock: () => T0, ingestedBy: 'svc-k8s-watcher' }, failed('k8s:run-1:failed'),
    );
    expect(result).toMatchObject({ incidentKey: 'immo-prod/immo/radar-refresh-pv', status: 'firing', deduped: false });
    expect(result.mails).toEqual(['firing']);
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]).toMatchObject({ kind: 'firing', status: 'pending' });
    expect(outbox.rows).toHaveLength(1);
    expect(outbox.rows[0]).toMatchObject({
      aggregateType: OPS_INCIDENT_AGGREGATE_TYPE,
      aggregateId: 'immo-prod/immo/radar-refresh-pv',
    });
    expect((outbox.rows[0] as { envelope: { ingestedBy: string } }).envelope.ingestedBy).toBe('svc-k8s-watcher');
  });

  it('replays the same eventId as deduped with no new incident write or mail', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const deps = { store, outbox, clock: () => T0 };
    await ingestOpsJobFailureEvent(deps, failed('k8s:run-1:failed'));
    const save = vi.spyOn(store, 'saveIncident');
    const replay = await ingestOpsJobFailureEvent(deps, failed('k8s:run-1:failed'));
    expect(replay).toMatchObject({ deduped: true, status: 'firing', conflict: false });
    expect(replay.mails).toEqual([]);
    expect(save).not.toHaveBeenCalled();
    expect(store.deliveries).toHaveLength(1);
    expect(outbox.rows).toHaveLength(1);
  });

  it('rejects the same eventId with a different payload as a conflict', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const deps = { store, outbox, clock: () => T0 };
    await ingestOpsJobFailureEvent(deps, failed('k8s:run-1:failed'));
    const save = vi.spyOn(store, 'saveIncident');
    const conflict = await ingestOpsJobFailureEvent(
      deps, failed('k8s:run-1:failed', { reason: 'quota' }),
    );
    expect(conflict).toMatchObject({ conflict: true, deduped: false, mails: [] });
    expect(save).not.toHaveBeenCalled();
    expect(store.deliveries).toHaveLength(1);
  });

  it('dedupes the same run reported by the app after k8s without a new mail', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const deps = { store, outbox, clock: () => T0 };
    await ingestOpsJobFailureEvent(deps, failed('k8s:run-9:failed', { runId: 'run-9' }));
    const duplicate = await ingestOpsJobFailureEvent(
      deps,
      {
        v: 1, eventId: 'app:run-9:failed', source: 'app', targetKey: 'immo-prod',
        jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
        runId: 'run-9', outcome: 'failed', reason: 'job-failed', severity: 'warning', occurredAt: T0,
      },
    );
    expect(duplicate).toMatchObject({ deduped: true, status: 'firing', mails: [] });
    expect(store.deliveries).toHaveLength(1);
  });

  it('marks an event older than the incident as stale without writing', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const deps = { store, outbox, clock: () => T0 };
    await ingestOpsJobFailureEvent(
      deps, failed('k8s:run-2:failed', { runId: 'run-2', occurredAt: '2026-11-09T10:05:00.000Z' }),
    );
    await ingestOpsJobFailureEvent(deps, {
      v: 1, eventId: 'k8s:run-2:succeeded', source: 'k8s', targetKey: 'immo-prod',
      jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
      runId: 'run-2', outcome: 'succeeded', occurredAt: '2026-11-09T10:06:00.000Z',
    });
    const save = vi.spyOn(store, 'saveIncident');
    const stale = await ingestOpsJobFailureEvent(
      deps, failed('k8s:run-1:failed', { runId: 'run-1', occurredAt: T0 }),
    );
    expect(stale).toMatchObject({ stale: true, mails: [], status: 'resolved' });
    expect(save).not.toHaveBeenCalled();
  });

  it('resolves on succeeded with a recovery delivery', async () => {
    const store = fakeStore();
    const outbox = fakeOutbox();
    const deps = { store, outbox, clock: () => T0 };
    await ingestOpsJobFailureEvent(deps, failed('k8s:run-1:failed'));
    const result = await ingestOpsJobFailureEvent(deps, {
      v: 1, eventId: 'k8s:run-1:succeeded', source: 'k8s', targetKey: 'immo-prod',
      jobRef: { namespace: 'immo', kind: 'CronJob', name: 'radar-refresh-pv' },
      runId: 'run-1', outcome: 'succeeded', occurredAt: T0,
    });
    expect(result).toMatchObject({ status: 'resolved', deduped: false });
    expect(result.mails).toEqual(['recovery']);
  });
});
