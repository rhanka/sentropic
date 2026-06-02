import type { EventEnvelope, TenantContext } from '@sentropic/contracts';

import type { CommentTarget } from './types.js';

/**
 * Comment lifecycle event types, aligned 1:1 with the live wire actions
 * (`created | updated | closed | reopened | deleted | reassigned`); only the
 * state idiom differs (`closed` -> `resolved`, per Decision D3).
 */
export type CommentEventType =
  | 'created'
  | 'updated'
  | 'resolved'
  | 'reopened'
  | 'deleted'
  | 'reassigned';

/**
 * A transport-agnostic comment lifecycle event. The host maps it to its
 * transport (e.g. Postgres `NOTIFY comment_events` / SSE / WebSocket); the
 * package never imports `pg`.
 */
export type CommentEvent = {
  type: CommentEventType;
  tenant: TenantContext;
  target: CommentTarget;
  commentId: string;
  threadId: string;
  data?: Record<string, unknown>;
};

/** Sink the store calls on every mutation. Sync; the host bridges to transport. */
export interface CommentEventSink {
  emit(event: CommentEvent): void;
}

/**
 * Recommended envelope wrapper for `tenant`/`ts`/`seq`/`redactedFields`
 * uniformity (Decision D4). `redactedFields` is a PASS-THROUGH marker only —
 * the package performs NO masking (Decision E).
 */
export type CommentEventEnvelope = EventEnvelope<CommentEvent>;

/** Wrap a bare `CommentEvent` into an `EventEnvelope` for uniform transport. */
export const toEventEnvelope = (
  event: CommentEvent,
  seq: number,
  ts: string,
): CommentEventEnvelope => ({
  type: event.type,
  seq,
  ts,
  tenant: event.tenant,
  payload: event,
});

/** Collecting sink useful for tests and deterministic replay. */
export class CollectingCommentEventSink implements CommentEventSink {
  readonly events: CommentEvent[] = [];

  emit(event: CommentEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events.length = 0;
  }
}

/** No-op sink (default when the host does not wire transport). */
export const noopCommentEventSink: CommentEventSink = {
  emit(): void {
    /* intentionally empty */
  },
};
