import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
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
  if (ids.length === 0) return;
  await db.delete(opsSeenEvents).where(inArray(opsSeenEvents.incidentId, ids));
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

  it('rejects the same eventId with a different payload as a conflict', async () => {
    const name = jobName('conflict');
    await postIngest(failedBody('conflict', `k8s:${name}-run-1:failed`));
    const replay = await postIngest({ ...failedBody('conflict', `k8s:${name}-run-1:failed`), reason: 'quota' });
    expect(replay.status).toBe(409);
    expect(await replay.json()).toMatchObject({ error: 'event_id_conflict' });
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

  it('rejects unknown fields and non-https links', async () => {
    const unknown = await postIngest({ ...failedBody('bad', 'k8s:bad-run:failed'), extra: 'nope' });
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toMatchObject({ error: 'unknown_field' });
    const link = await postIngest({
      ...failedBody('bad', 'k8s:bad-run:failed'),
      links: { logs: 'http://logs.example.com/run' },
    });
    expect(link.status).toBe(400);
    expect(await link.json()).toMatchObject({ error: 'bad_links' });
  });

  it('rejects future timestamps against the server clock', async () => {
    const response = await postIngest({
      ...failedBody('future', 'k8s:future-run:failed'),
      occurredAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'bad_occurred_at' });
  });

  it('rejects oversized bodies before parsing', async () => {
    const big = await router.request('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...failedBody('big', 'k8s:big-run:failed'), detail: 'x'.repeat(40 * 1024) }),
    });
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: 'body_too_large' });
  });

  it('serializes concurrent ingests of one incident into a single firing mail', async () => {
    const name = jobName('race');
    const bodies = [1, 2].map((run) => failedBody('race', `k8s:${name}-run-${run}:failed`));
    const responses = await Promise.all(bodies.map((body) => postIngest(body)));
    for (const response of responses) expect(response.status).toBe(200);
    const results = (await Promise.all(responses.map((r) => r.json()))) as { mails: string[] }[];
    expect(results.flatMap((r) => r.mails).sort()).toEqual(['firing']);
    const incidents = await db.select().from(opsIncidents).where(eq(opsIncidents.targetKey, TARGET_KEY));
    expect(incidents).toHaveLength(1);
    const deliveries = await db.select().from(opsNotificationDeliveries)
      .where(eq(opsNotificationDeliveries.incidentId, incidents[0]!.id));
    expect(deliveries.filter((d) => d.kind === 'firing')).toHaveLength(1);
  });

  it('rejects unauthenticated ingestion with the service guard', async () => {
    const guarded = createOpsJobFailuresRouter({ ingest: ingestOpsJobFailureEventTx });
    const response = await guarded.request('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failedBody('guarded', 'k8s:guarded-run:failed')),
    });
    expect(response.status).toBe(401);
  });

  it('binds the authenticated client to its targets', async () => {
    const withClient = (clientId: string) =>
      createOpsJobFailuresRouter({
        ingest: ingestOpsJobFailureEventTx,
        guard: async (c, next) => {
          c.set('serviceClient', { clientId, scopes: ['service:ops-job-failure-ingest'], jkt: null });
          await next();
        },
        allowlist: { 'svc-watcher': [TARGET_KEY] },
      });
    const ok = await withClient('svc-watcher').request('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failedBody('bound', `k8s:${jobName('bound')}-run-1:failed`)),
    });
    expect(ok.status).toBe(200);
    const foreign = await withClient('svc-other').request('/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(failedBody('bound', `k8s:${jobName('bound')}-run-2:failed`)),
    });
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ error: 'forbidden_target' });
  });
});
