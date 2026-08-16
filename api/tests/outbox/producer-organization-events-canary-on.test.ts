/**
 * producer-organization-events-canary-on.test.ts — BR-60-act canary (ON).
 *
 * With OUTBOX_CANARY_ORGANIZATIONS=true, organizations.ts mutations co-write
 * `control.event_outbox` (channel `organization_events`) instead of the bespoke
 * NOTIFY — single emission path. The dispatcher republishes on the SAME NOTIFY
 * channel/payload shape (`{ organization_id }`), so the existing SSE bridge
 * (streams.ts, unchanged) stays the real consumer, including cross-workspace
 * isolation (BR-60-act must not regress the existing tenancy guarantee proven
 * by `api/tests/api/streams.test.ts`'s bespoke-NOTIFY equivalent).
 *
 * organizations.ts reads the flag once at module load. ES module `import`
 * declarations are hoisted above any top-level statement regardless of source
 * position, so setting `process.env` textually before a static `import { app }`
 * does NOT run first. The app (and therefore organizations.ts) must be
 * dynamically imported, in `beforeAll`, AFTER the env var is set — AND after
 * `vi.resetModules()`, since this suite's other files may already have
 * imported (and Node/Vite cached) `../../src/app` in the same worker, which a
 * plain dynamic import would silently reuse instead of re-evaluating.
 */
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createTestId } from '../utils/test-helpers';
import { createAuthenticatedUser, authenticatedRequest, cleanupAuthData } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import { organizations, workspaces } from '../../src/db/schema';
import { ensureWorkspaceForUser } from '../../src/services/workspace-service';
import { OutboxDispatcher } from '../../src/services/outbox/outbox-dispatcher';

let app: typeof import('../../src/app').app;

beforeAll(async () => {
  process.env.OUTBOX_CANARY_ORGANIZATIONS = 'true';
  vi.resetModules();
  ({ app } = await import('../../src/app'));
});

afterAll(() => {
  delete process.env.OUTBOX_CANARY_ORGANIZATIONS;
  vi.resetModules();
});

type SseEvent = { event?: string; data?: any };

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const parts = buffer.split('\n\n');
  const complete = parts.slice(0, -1);
  const rest = parts[parts.length - 1] ?? '';
  const events: SseEvent[] = [];
  for (const chunk of complete) {
    const lines = chunk.split('\n').filter(Boolean);
    let event: string | undefined;
    let dataLine: string | undefined;
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice('event:'.length).trim();
      if (line.startsWith('data:')) dataLine = line.slice('data:'.length).trim();
    }
    let data: any;
    if (dataLine) {
      try {
        data = JSON.parse(dataLine);
      } catch {
        data = dataLine;
      }
    }
    events.push({ event, data });
  }
  return { events, rest };
}

async function openSse(sessionToken: string) {
  const res = await app.request('/api/v1/streams/sse', { headers: { cookie: `session=${sessionToken}` } });
  expect(res.status).toBe(200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await Promise.race([reader.read(), sleep(500)]);
  return reader;
}

/**
 * Reads two SSE streams concurrently (one in-flight `read()` per reader, resumed only after
 * its own previous read resolves — never two overlapping reads on the same reader) and stops
 * as soon as `predicate` matches the accumulated events, or after `maxMs` as a bounded safety
 * net. This replaces a fixed wall-clock collection window: the positive proof (the watched
 * reader's event arrives) is awaited on the real signal, not guessed at with a fixed sleep, and
 * the paired reader's negative assertion (must NOT have received the event) is evaluated over
 * that exact same real-time interval — both readers had identical opportunity — instead of an
 * independently-timed window that can under-run the positive signal under load.
 */
async function collectConcurrentUntil(
  readers: [ReadableStreamDefaultReader<Uint8Array>, ReadableStreamDefaultReader<Uint8Array>],
  predicate: (events: [SseEvent[], SseEvent[]]) => boolean,
  maxMs: number,
): Promise<[SseEvent[], SseEvent[]]> {
  const decoder = new TextDecoder();
  const buffers: [string, string] = ['', ''];
  const events: [SseEvent[], SseEvent[]] = [[], []];
  const pending = readers.map((reader, i) => reader.read().then((result) => ({ i, result })));
  const deadline = Date.now() + maxMs;

  for (;;) {
    const timeLeft = deadline - Date.now();
    if (timeLeft <= 0) break;
    const winner = await Promise.race([...pending, sleep(timeLeft).then(() => null)]);
    if (!winner) break;
    const { i, result } = winner;
    if (!result.done) {
      buffers[i] += decoder.decode(result.value, { stream: true });
      const { events: parsed, rest } = parseSse(buffers[i]);
      events[i].push(...parsed);
      buffers[i] = rest;
      pending[i] = readers[i].read().then((r) => ({ i, result: r }));
    } else {
      pending[i] = new Promise(() => {});
    }
    if (predicate(events)) break;
  }
  return events;
}

async function getOutboxRowForOrg(organizationId: string): Promise<Record<string, unknown> | null> {
  const rows = (await db.all(sql`
    SELECT id, aggregate_type, aggregate_id, seq, status, channel, envelope
    FROM control.event_outbox
    WHERE aggregate_type = 'organization' AND aggregate_id = ${organizationId}
  `)) as Array<Record<string, unknown>>;
  return rows[0] ?? null;
}

describe('Producer (canary ON): organization_events via outbox (BR-60-act)', () => {
  afterEach(async () => {
    await cleanupAuthData();
  });

  it('co-writes an outbox row (channel=organization_events) instead of the bespoke NOTIFY', async () => {
    const suffix = createTestId();
    const user = await createAuthenticatedUser('editor', `editor-outbox-${suffix}@example.com`);

    const res = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Outbox Canary Org ${suffix}`,
      industry: 'Test',
    });
    expect(res.status).toBe(201);
    const org = await res.json();

    try {
      const outboxRow = await getOutboxRowForOrg(org.id);
      expect(outboxRow).not.toBeNull();
      expect(outboxRow!.channel).toBe('organization_events');
      expect(outboxRow!.status).toBe('pending');
      expect(outboxRow!.envelope).toEqual({ organization_id: org.id });
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });

  it('dispatches the outbox row and preserves cross-workspace SSE isolation', async () => {
    const suffix = createTestId();
    const admin = await createAuthenticatedUser('admin_app', `admin-outbox-sse-${suffix}@example.com`);
    const user = await createAuthenticatedUser('editor', `user-outbox-sse-${suffix}@example.com`);
    await ensureWorkspaceForUser(admin.id);
    await ensureWorkspaceForUser(user.id);

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.ownerUserId, user.id)).limit(1);
    expect(ws?.id).toBeTruthy();

    const adminReader = await openSse(admin.sessionToken!);
    const userReader = await openSse(user.sessionToken!);

    const orgRes = await authenticatedRequest(app, 'POST', '/api/v1/organizations', user.sessionToken!, {
      name: `Outbox Canary SSE Org ${suffix}`,
      industry: 'Test',
    });
    expect(orgRes.status).toBe(201);
    const org = await orgRes.json();

    // Test env disables dispatcher autostart (docker-compose.test.yml): dispatch
    // the pending row manually, through the REAL EventBusPort (pg NOTIFY), so the
    // live SSE bridge receives it exactly as it would in production.
    const dispatcher = new OutboxDispatcher({ maxAttempts: 3 });
    const sweepResult = await dispatcher.runDispatchSweep();
    expect(sweepResult.dispatched).toBeGreaterThanOrEqual(1);

    try {
      const [userEvents, adminEvents] = await collectConcurrentUntil(
        [userReader, adminReader],
        ([userEvts]) =>
          userEvts.some((e) => e.event === 'organization_update' && e.data?.organizationId === org.id),
        8000,
      );
      await userReader.cancel();
      await adminReader.cancel();

      const userOrgUpdates = userEvents.filter((e) => e.event === 'organization_update');
      expect(userOrgUpdates.some((e) => e.data?.organizationId === org.id)).toBe(true);

      const adminOrgUpdates = adminEvents.filter((e) => e.event === 'organization_update');
      expect(adminOrgUpdates.some((e) => e.data?.organizationId === org.id)).toBe(false);

      const outboxRow = await getOutboxRowForOrg(org.id);
      expect(outboxRow!.status).toBe('dispatched');
    } finally {
      await db.delete(organizations).where(eq(organizations.id, org.id));
    }
  });
});
