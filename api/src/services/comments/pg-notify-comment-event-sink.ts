import type { Pool } from 'pg';

import { pool as defaultPool } from '../../db/client';
import { logger } from '../../logger';
import { incrementCommentEvent } from './comment-metrics';

/**
 * BR-42d Lot 3 — origin-aware, HOST-CONTROLLED comment event sink.
 *
 * Bridges comment lifecycle mutations to the live `comment_events` Postgres
 * NOTIFY stream consumed by `streams.ts:744-756` (LISTEN -> SSE). It is the
 * app-local emission half of the SPEC §4 "host-controlled emission" model:
 * `PgCommentStore` is PERSISTENCE-ONLY and never emits; each CALL SITE (REST
 * route / AI tool-service / queue auto path) emits EXACTLY ONE wire event via
 * this sink, supplying an EXPLICIT `{action, key}` descriptor.
 *
 * The sink NEVER infers the wire key — only the call site knows the live
 * per-(origin,event) combo (SPEC §4 matrix). The call site selects which id
 * lands in `data` via `key`:
 *   - `key:'comment_id'` -> `data.comment_id = commentId`
 *       REST created/updated/closed/reopened/deleted (`comments.ts:205,254,283,312,337`),
 *       AI trace-note created (`tool-service.ts:1411`),
 *       auto created (`tool-service.ts:1602`, `queue-manager.ts:1466`).
 *   - `key:'thread_id'` -> `data.thread_id = threadId`
 *       AI close (`tool-service.ts:1364`), AI reassign (`tool-service.ts:1381`).
 *
 * Payload is byte-identical to the three live `notifyCommentEvent` copies it
 * will replace (Lot 4/5): `{ workspace_id, context_type, context_id,
 * data: { action, <comment_id|thread_id> } }`.
 *
 * Lifecycle (SPEC DEC-4): a SINGLE shared instance, constructed once at app
 * bootstrap over the shared `pool`, injected into the REST router, tool-service,
 * and the out-of-request queue auto-comment path.
 *
 * Awaited back-pressure (SPEC §4 must-fix #6): all three live sites `await` the
 * NOTIFY round-trip. `emit()` is therefore awaitable; the host path awaits it so
 * the NOTIFY completes before the HTTP response / before the next AI action.
 * Errors are logged (observability choke-point) and RE-THROWN so the awaited
 * call rejects exactly as live does — emission runs AFTER persistence, so a
 * NOTIFY failure never corrupts the already-persisted mutation.
 */

/** Which live id column the call site routes into `data` (SPEC §4 matrix). */
export type CommentEventKey = 'comment_id' | 'thread_id';

/** Origin of the emission. Carried for observability (§5) only; the wire `key`
 * is the explicit descriptor, NEVER inferred from origin (SPEC §4 KEY FINDING:
 * AI is not uniformly `thread_id`). */
export type CommentEventOrigin = 'rest' | 'ai' | 'auto';

/**
 * Explicit emission descriptor supplied by the call site. The sink carries
 * `{action, key}` verbatim onto the wire; it does not guess either field.
 */
export type CommentEmission = {
  workspaceId: string;
  contextType: string;
  contextId: string;
  /** Live wire action (`created|updated|closed|reopened|deleted|reassigned`). */
  action: string;
  /** Selects which id is written into `data`. */
  key: CommentEventKey;
  /** Required when `key === 'comment_id'`. */
  commentId?: string;
  /** Required when `key === 'thread_id'`. */
  threadId?: string;
  /** Observability only (SPEC §5); never affects the wire payload. */
  origin?: CommentEventOrigin;
};

/**
 * Escape a NOTIFY JSON payload for safe inlining into a `NOTIFY` statement.
 *
 * IDENTICAL to the live `escapeNotifyPayload` (`comments.ts:16`) and the inline
 * `.replace(/'/g, "''")` in tool-service / queue-manager. Lot 4 DELETES the
 * `comments.ts` copy and imports THIS one, so after Lot 4 there is ONE escaper
 * (this module is the home of comment NOTIFY escaping).
 */
export function escapeNotifyPayload(payload: Record<string, unknown>): string {
  return JSON.stringify(payload).replace(/'/g, "''");
}

export type PgNotifyCommentEventSinkOptions = {
  /** pg Pool (defaults to the shared app `pool`). */
  pool?: Pool;
};

export class PgNotifyCommentEventSink {
  private readonly pool: Pool;

  constructor(options: PgNotifyCommentEventSinkOptions = {}) {
    this.pool = options.pool ?? defaultPool;
  }

  /**
   * Emit EXACTLY ONE `comment_events` NOTIFY for the supplied descriptor and
   * AWAIT the round-trip (matches live awaited back-pressure). Resolves once the
   * NOTIFY has flushed; rejects (after logging) if the NOTIFY fails.
   */
  async emit(emission: CommentEmission): Promise<void> {
    const data: Record<string, unknown> = { action: emission.action };
    if (emission.key === 'comment_id') {
      data.comment_id = emission.commentId;
    } else {
      data.thread_id = emission.threadId;
    }

    const payload = {
      workspace_id: emission.workspaceId,
      context_type: emission.contextType,
      context_id: emission.contextId,
      data,
    };

    const client = await this.pool.connect();
    try {
      await client.query(`NOTIFY comment_events, '${escapeNotifyPayload(payload)}'`);
      // Observability choke-point (SPEC §5): AFTER the NOTIFY round-trip
      // succeeds, emit ONE structured log line + bump the in-process counter.
      // This is observability-ONLY: it MUST NOT alter the wire payload and MUST
      // NEVER throw into the awaited caller — both are swallowed. (`userId` is
      // intentionally NOT logged here: the emit descriptor does not carry it
      // this lot; adding it is a future optional descriptor field.)
      try {
        incrementCommentEvent(emission.action);
        logger.info(
          {
            event: `comment.${emission.action}`,
            origin: emission.origin,
            workspaceId: emission.workspaceId,
            contextType: emission.contextType,
            ...(emission.commentId ? { commentId: emission.commentId } : {}),
            ...(emission.threadId ? { threadId: emission.threadId } : {}),
          },
          'comment event emitted',
        );
      } catch (observabilityError) {
        // Observability failures are swallowed — they must never perturb the
        // already-flushed NOTIFY nor reject the awaited emit.
        logger.error(
          { event: 'comment.observability_failed', err: observabilityError },
          'comment event observability failed (swallowed)',
        );
      }
    } catch (error) {
      // Observability choke-point: log, then re-throw so the awaited emit
      // rejects exactly as the live awaited NOTIFY does (SPEC §4 must-fix #6).
      logger.error(
        {
          event: 'comment.notify_failed',
          origin: emission.origin,
          workspaceId: emission.workspaceId,
          contextType: emission.contextType,
          action: emission.action,
          err: error,
        },
        'comment_events NOTIFY failed',
      );
      throw error;
    } finally {
      client.release();
    }
  }
}
