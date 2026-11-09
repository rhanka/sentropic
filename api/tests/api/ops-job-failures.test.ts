import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { db } from '../../src/db/client';
import {
  eventOutbox,
  opsIncidents,
  opsNotificationDeliveries,
  opsSeenEvents,
} from '../../src/db/control-schema';
import { createOpsJobFailuresRouter } from '../../src/routes/ops-job-failures';
import { ingestOpsJobFailureEventTx } from '../../src/services/notifications/ops-ingest';

const TARGET_KEY = 'test-notify-l1';
const JOB_RUN = randomUUID().slice(0, 8);
const jobName = (name: string): string => `${name}-${JOB_RUN}`;

const failedBody = (name: string, eventId: string) => ({
  v: 1,
  eventId,
  source: 'k8s',
  targetKey: TARGET_KEY,
  jobRef: { namespace: 'immo', kind: 'CronJob', name: jobName(name) },
  runId: eventId,
  outcome: 'failed',
  reason: 'job-failed',
  severity: 'warning',
  occurredAt: new Date().toISOString(),
});

const router = createOpsJobFailuresRouter({
  ingest: ingestOpsJobFailureEventTx,
  guard: async (_c, next) => next(),
});

const postIngest = (body: unknown): Promise<Response> =>
  router.request('/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

afterEach(async () => {
  const incidents = await db.select({ id: opsIncidents.id }).from(opsIncidents)
    .where(eq(opsIncidents.targetKey, TARGET_KEY));
  const ids = incidents.map((row) => row.id);
  await db.delete(opsNotificationDeliveries).where(eq(opsNotificationDeliveries.targetKey, TARGET_KEY));
  await db.delete(opsSeenEvents);
  await db.delete(opsIncidents).where(eq(opsIncidents.targetKey, TARGET_KEY));
  for (const id of ids) {
    await db.delete(eventOutbox).where(eq(eventOutbox.aggregateId, id));
  }
});

describe('POST /api/v1/ops/ingest', () => {
  it('ingests a failed event into a firing incident with a pending delivery', async () => {
    const name = jobName('radar');
    const response = await postIngest(failedBody('radar', `k8s:${name}-run-1:failed`));
    expect(response.status).toBe(200);
    const result = await response.json() as { incidentKey: string; status: string; mails: string[]; deduped: boolean };
    expect(result).toMatchObject({ status: 'firing', mails: ['firing'], deduped: false });

    const incidents = await db.select().from(opsIncidents).where(eq(opsIncidents.id, result.incidentKey));
    expect(incidents).toHaveLength(1);
    expect(incidents[0]).toMatchObject({ status: 'firing', occurrenceCount: 1, targetKey: TARGET_KEY });

    const deliveries = await db.select().from(opsNotificationDeliveries)
      .where(eq(opsNotificationDeliveries.incidentId, result.incidentKey));
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]).toMatchObject({ kind: 'firing', targetKey: TARGET_KEY });

    const seen = await db.select().from(opsSeenEvents);
    expect(seen.some((row) => row.incidentId === result.incidentKey)).toBe(true);
  });

  it('replays the same eventId as deduped with no second mail', async () => {
    const name = jobName('replay');
    const body = failedBody('replay', `k8s:${name}-run-1:failed`);
    const first = await (await postIngest(body)).json() as { incidentKey: string };
    const replay = await postIngest(body);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ incidentKey: first.incidentKey, deduped: true, mails: [] });
    const deliveries = await db.select().from(opsNotificationDeliveries)
      .where(eq(opsNotificationDeliveries.incidentId, first.incidentKey));
    expect(deliveries).toHaveLength(1);
  });

  it('resolves the incident on succeeded with a recovery delivery', async () => {
    const name = jobName('recover');
    const failed = failedBody('recover', `k8s:${name}-run-1:failed`);
    const opened = await (await postIngest(failed)).json() as { incidentKey: string };
    const response = await postIngest({
      v: 1, eventId: `k8s:${name}-run-1:succeeded`, source: 'k8s', targetKey: TARGET_KEY,
      jobRef: { namespace: 'immo', kind: 'CronJob', name },
      runId: `k8s:${name}-run-1`, outcome: 'succeeded', occurredAt: new Date().toISOString(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'resolved', mails: ['recovery'] });
    const incidents = await db.select().from(opsIncidents).where(eq(opsIncidents.id, opened.incidentKey));
    expect(incidents[0]).toMatchObject({ status: 'resolved' });
  });

  it('rejects off-contract payloads without touching the store', async () => {
    const response = await postIngest({ ...failedBody('bad', 'k8s:bad-run:failed'), reason: 'unknown-timeout' });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'bad_reason' });
    const incidents = await db.select().from(opsIncidents).where(eq(opsIncidents.targetKey, TARGET_KEY));
    expect(incidents).toHaveLength(0);
  });
});
