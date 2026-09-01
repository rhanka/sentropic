/**
 * stream-purge.test.ts — RED characterization tests for BR-44 WI-2.
 *
 * Lot 0: pin current state — no purge runs today, rows accumulate forever.
 * Lot 2: these tests must turn GREEN after stream purge is implemented.
 *
 * Tests:
 *   1. Old stream events are purged in batches (RED until Lot 2).
 *   2. Active stream events (<6h) are never purged (RED until Lot 2).
 *   3. since_minutes clamp is enforced by the extracted GET /streams/active transport.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { chatStreamEvents } from '../../src/db/schema';
import { createId } from '../../src/utils/id';
import { app } from '../../src/app';
import { createAuthenticatedUser, cleanupAuthData } from '../utils/auth-helper';

async function insertStreamEvent(createdAt: Date): Promise<{ id: string; streamId: string }> {
  const id = createId();
  const streamId = createId();
  await db.insert(chatStreamEvents).values({
    id,
    streamId,
    eventType: 'content_delta',
    data: { text: 'test' } as unknown as typeof chatStreamEvents.$inferInsert['data'],
    sequence: 1,
    createdAt,
  });
  return { id, streamId };
}

async function countStreamEvent(id: string): Promise<number> {
  const rows = (await db.all(sql`
    SELECT COUNT(*)::int AS cnt FROM chat_stream_events WHERE id = ${id}
  `)) as Array<{ cnt: number }>;
  return rows[0]?.cnt ?? 0;
}

describe('Stream purge — characterization (BR-44 WI-2)', () => {
  afterEach(async () => {
    // Clean up test stream events.
    await db.run(sql`DELETE FROM chat_stream_events WHERE event_type = 'content_delta' AND data->>'text' = 'test'`);
    await cleanupAuthData();
  });

  it('should purge stream events older than retention days (RED until Lot 2)', async () => {
    // Requires: purgeOldStreamEvents() from api/src/services/chat/stream-purge.ts.
    const { purgeOldStreamEvents } = await import('../../src/services/chat/stream-purge.js').catch(() => ({
      purgeOldStreamEvents: null,
    }));
    if (!purgeOldStreamEvents) {
      expect(purgeOldStreamEvents).not.toBeNull();
      return;
    }

    // Insert an event 10 days ago (older than 7d retention).
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const oldEvent = await insertStreamEvent(oldDate);

    const deleted = await purgeOldStreamEvents(7);
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await countStreamEvent(oldEvent.id)).toBe(0);
  });

  it('should NOT purge active stream events (<6h old) (RED until Lot 2)', async () => {
    const { purgeOldStreamEvents } = await import('../../src/services/chat/stream-purge.js').catch(() => ({
      purgeOldStreamEvents: null,
    }));
    if (!purgeOldStreamEvents) {
      expect(purgeOldStreamEvents).not.toBeNull();
      return;
    }

    // Insert an event 1 hour ago (well within the 6h active window and 7d retention).
    const recentDate = new Date(Date.now() - 60 * 60 * 1000);
    const recentEvent = await insertStreamEvent(recentDate);

    await purgeOldStreamEvents(7);
    expect(await countStreamEvent(recentEvent.id)).toBe(1);
  });

  it('should clamp since_minutes to retention floor on GET /streams/active (RED until Lot 2)', async () => {
    const user = await createAuthenticatedUser('admin_app');
    const outsideRetention = await insertStreamEvent(
      new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
    );
    // since_minutes=99999 should be clamped to STREAM_RETENTION_DAYS*1440 (default 7*1440=10080).
    // The response must still return 200 without error.
    const res = await app.request('/api/v1/streams/active?since_minutes=99999', {
      method: 'GET',
      headers: {
        Cookie: `session=${user.sessionToken}`,
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('streamIds');
    expect(Array.isArray(body.streamIds)).toBe(true);
    expect(body.streamIds).not.toContain(outsideRetention.streamId);
  });
});
