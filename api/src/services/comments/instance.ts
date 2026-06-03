import { db, pool } from '../../db/client';
import { createId } from '../../utils/id';
import { PgCommentStore } from './pg-comment-store';
import { PgNotifyCommentEventSink } from './pg-notify-comment-event-sink';

/**
 * BR-42d Lot 4 — the SINGLE shared comment store + sink instance (SPEC DEC-4).
 *
 * Constructed lazily at module load over the shared app `db`/`pool` so the same
 * `PgCommentStore` (emit-free persistence) and origin-aware
 * `PgNotifyCommentEventSink` (host-controlled wire emission) are reused by every
 * call site: the REST router (Lot 4) now, and the AI tool-service + the
 * out-of-request queue-manager auto path (Lot 5).
 *
 * The store and sink are stateless over the connection pool, so a module-level
 * singleton is safe and avoids touching app bootstrap (SPEC §8 Lot 4 note).
 */
export const commentStore = new PgCommentStore({ db, createId });

export const commentEventSink = new PgNotifyCommentEventSink({ pool });
