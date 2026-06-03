import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pool } from '../../src/db/client';
import { createId } from '../../src/utils/id';
import { logger } from '../../src/logger';
import {
  PgNotifyCommentEventSink,
  escapeNotifyPayload,
} from '../../src/services/comments/pg-notify-comment-event-sink';
import {
  getCommentEventCounts,
  resetCommentEventCounts,
} from '../../src/services/comments/comment-metrics';

/**
 * BR-42d Lot 3 — `PgNotifyCommentEventSink` wire-test (sink in ISOLATION).
 *
 * Drives the sink directly (NO routes, NO store) against the FULL Lot-0
 * per-(origin,event) wire-key matrix, asserting the emitted `NOTIFY
 * comment_events` payload is BYTE-IDENTICAL to the three live `notifyCommentEvent`
 * copies it will replace (`{workspace_id, context_type, context_id,
 * data:{action, <comment_id|thread_id>}}`). Spying on `pool.connect` mirrors the
 * Lot-0 wire test (`comments-wire.test.ts`): the spy delegates to the real
 * client so the NOTIFY actually executes and the awaited round-trip is
 * preserved, while the FULL emitted SQL string is captured for byte comparison.
 */

describe('PgNotifyCommentEventSink wire-payload (BR-42d Lot 3)', () => {
  let sink: PgNotifyCommentEventSink;
  let captured: string[];
  let connectSpy: ReturnType<typeof vi.spyOn>;

  const workspaceId = createId();
  const contextType = 'initiative';
  const contextId = createId();

  beforeEach(() => {
    captured = [];
    const realConnect = pool.connect.bind(pool);
    const WRAPPED = Symbol.for('sink-wire-test-wrapped');
    connectSpy = vi.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      const client: any = await (realConnect as any)(...args);
      if (!client[WRAPPED]) {
        const realQuery = client.query.bind(client);
        client.query = (...qargs: any[]) => {
          const sql = typeof qargs[0] === 'string' ? qargs[0] : qargs[0]?.text;
          if (typeof sql === 'string' && sql.startsWith('NOTIFY comment_events')) {
            captured.push(sql);
          }
          return realQuery(...qargs);
        };
        client[WRAPPED] = true;
      }
      return client;
    });

    sink = new PgNotifyCommentEventSink({ pool });
  });

  afterEach(() => {
    connectSpy.mockRestore();
  });

  /** Re-derive the live wire payload for byte comparison. */
  function liveNotifySql(action: string, idKey: 'comment_id' | 'thread_id', id: string): string {
    const payload = {
      workspace_id: workspaceId,
      context_type: contextType,
      context_id: contextId,
      data: { action, [idKey]: id },
    };
    return `NOTIFY comment_events, '${escapeNotifyPayload(payload)}'`;
  }

  // --- REST origin: every event keyed by comment_id (comments.ts:205,254,283,312,337) ---

  it('REST created emits {created, comment_id} byte-identical to the live payload', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
  });

  it('REST updated emits {updated, comment_id}', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'updated',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('updated', 'comment_id', commentId)]);
  });

  it('REST closed emits {closed, comment_id}', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'closed',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('closed', 'comment_id', commentId)]);
  });

  it('REST reopened emits {reopened, comment_id}', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'reopened',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('reopened', 'comment_id', commentId)]);
  });

  it('REST deleted emits {deleted, comment_id}', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'deleted',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('deleted', 'comment_id', commentId)]);
  });

  // --- AI origin: close/reassign keyed by thread_id (tool-service.ts:1364,1381) ---

  it('AI close emits {closed, thread_id}', async () => {
    const threadId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'closed',
      key: 'thread_id',
      threadId,
      origin: 'ai',
    });
    expect(captured).toEqual([liveNotifySql('closed', 'thread_id', threadId)]);
  });

  it('AI reassign emits {reassigned, thread_id}', async () => {
    const threadId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'reassigned',
      key: 'thread_id',
      threadId,
      origin: 'ai',
    });
    expect(captured).toEqual([liveNotifySql('reassigned', 'thread_id', threadId)]);
  });

  // --- AI trace-note created keyed by comment_id, NOT thread_id (tool-service.ts:1411) ---

  it('AI trace-note created emits {created, comment_id} (NOT thread_id)', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'ai',
    });
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
    // Explicitly assert the wire carries comment_id, not thread_id.
    expect(captured[0]).toContain('"comment_id"');
    expect(captured[0]).not.toContain('"thread_id"');
  });

  // --- auto origin: created keyed by comment_id (tool-service.ts:1602, queue-manager.ts:1466) ---

  it('auto created emits {created, comment_id}', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'auto',
    });
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
  });

  // --- key-selection invariant: the sink carries the EXPLICIT key, never infers ---

  it('routes commentId into data when key=comment_id and threadId is also supplied', async () => {
    const commentId = createId();
    const threadId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      threadId,
      origin: 'ai',
    });
    // Only comment_id reaches the wire; thread_id is ignored when key=comment_id.
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
    expect(captured[0]).not.toContain(threadId);
  });

  it('routes threadId into data when key=thread_id and commentId is also supplied', async () => {
    const commentId = createId();
    const threadId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'closed',
      key: 'thread_id',
      threadId,
      commentId,
      origin: 'ai',
    });
    expect(captured).toEqual([liveNotifySql('closed', 'thread_id', threadId)]);
    expect(captured[0]).not.toContain(commentId);
  });

  // --- awaitable flush: the NOTIFY has executed by the time emit() resolves ---

  it('the awaitable emit resolves only AFTER the NOTIFY has flushed', async () => {
    const commentId = createId();
    expect(captured).toEqual([]);
    const promise = sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    // Not yet flushed synchronously after the call returns the promise.
    await promise;
    // Once awaited, the NOTIFY is captured (round-trip completed).
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
  });

  it('escaping single quotes in ids matches the live escaper byte-for-byte', async () => {
    // A pathological id containing a single quote exercises the '' escaping path.
    const commentId = `id-with-'quote`;
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(captured).toEqual([liveNotifySql('created', 'comment_id', commentId)]);
    // The raw quote is doubled on the wire.
    expect(captured[0]).toContain("id-with-''quote");
  });
});

/**
 * BR-42d Lot 6 — observability at the sink choke-point (SPEC §5).
 *
 * The sink is the SOLE comment NOTIFY emitter, hence the single observability
 * choke-point. After each successful NOTIFY it (1) bumps a provider-neutral
 * in-process per-`action` counter and (2) emits ONE structured `comment.<action>`
 * log line. Both are observability-ONLY: they MUST NOT perturb the byte-identical
 * wire payload, and MUST NEVER throw into the awaited caller.
 */
describe('PgNotifyCommentEventSink observability (BR-42d Lot 6)', () => {
  let sink: PgNotifyCommentEventSink;
  let captured: string[];
  let connectSpy: ReturnType<typeof vi.spyOn>;

  const workspaceId = createId();
  const contextType = 'initiative';
  const contextId = createId();

  beforeEach(() => {
    resetCommentEventCounts();
    captured = [];
    const realConnect = pool.connect.bind(pool);
    const WRAPPED = Symbol.for('sink-obs-test-wrapped');
    connectSpy = vi.spyOn(pool, 'connect').mockImplementation(async (...args: any[]) => {
      const client: any = await (realConnect as any)(...args);
      if (!client[WRAPPED]) {
        const realQuery = client.query.bind(client);
        client.query = (...qargs: any[]) => {
          const sql = typeof qargs[0] === 'string' ? qargs[0] : qargs[0]?.text;
          if (typeof sql === 'string' && sql.startsWith('NOTIFY comment_events')) {
            captured.push(sql);
          }
          return realQuery(...qargs);
        };
        client[WRAPPED] = true;
      }
      return client;
    });

    sink = new PgNotifyCommentEventSink({ pool });
  });

  afterEach(() => {
    connectSpy.mockRestore();
    vi.restoreAllMocks();
    resetCommentEventCounts();
  });

  it('increments the in-process counter by action on each successful emit', async () => {
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId: createId(),
      origin: 'rest',
    });
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId: createId(),
      origin: 'ai',
    });
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'reassigned',
      key: 'thread_id',
      threadId: createId(),
      origin: 'ai',
    });
    expect(getCommentEventCounts()).toEqual({ created: 2, reassigned: 1 });
  });

  it('emits ONE structured comment.<action> log line per emit (comment_id key)', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger as any);
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenCalledWith(
      {
        event: 'comment.created',
        origin: 'rest',
        workspaceId,
        contextType,
        commentId,
      },
      'comment event emitted',
    );
  });

  it('the structured log carries threadId (not commentId) when key=thread_id', async () => {
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger as any);
    const threadId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'closed',
      key: 'thread_id',
      threadId,
      origin: 'ai',
    });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const [logObject] = infoSpy.mock.calls[0];
    expect(logObject).toEqual({
      event: 'comment.closed',
      origin: 'ai',
      workspaceId,
      contextType,
      threadId,
    });
    // userId is intentionally absent this lot (descriptor does not carry it).
    expect(logObject).not.toHaveProperty('userId');
  });

  it('observability NEVER perturbs the byte-identical wire payload', async () => {
    const commentId = createId();
    await sink.emit({
      workspaceId,
      contextType,
      contextId,
      action: 'created',
      key: 'comment_id',
      commentId,
      origin: 'rest',
    });
    const payload = {
      workspace_id: workspaceId,
      context_type: contextType,
      context_id: contextId,
      data: { action: 'created', comment_id: commentId },
    };
    expect(captured).toEqual([`NOTIFY comment_events, '${escapeNotifyPayload(payload)}'`]);
  });

  it('a log failure is swallowed and NEVER rejects the awaited emit (NOTIFY already flushed)', async () => {
    // Force the observability log to throw; the emit must still resolve and the
    // NOTIFY must still have flushed (wire payload intact).
    const infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {
      throw new Error('log sink down');
    });
    vi.spyOn(logger, 'error').mockImplementation(() => logger as any);
    const commentId = createId();
    await expect(
      sink.emit({
        workspaceId,
        contextType,
        contextId,
        action: 'created',
        key: 'comment_id',
        commentId,
        origin: 'rest',
      }),
    ).resolves.toBeUndefined();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    // The NOTIFY still flushed despite the swallowed observability failure.
    expect(captured.length).toBe(1);
    expect(captured[0]).toContain(commentId);
    // The counter still incremented (it runs before the throwing log call).
    expect(getCommentEventCounts()).toEqual({ created: 1 });
  });
});
