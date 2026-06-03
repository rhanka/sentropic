/**
 * BR-42d Lot 6 — provider-neutral, IN-PROCESS comment-event counter (SPEC §5).
 *
 * The sole comment NOTIFY emitter (`PgNotifyCommentEventSink.emit()`) is the
 * single observability choke-point. After each successful emit it increments a
 * per-`action` counter here. This is deliberately the SMALLEST possible
 * primitive: a module-level `Map<action, count>` — NO metrics backend, NO
 * Prometheus/OTel exporter, NO durable provider/vendor names (plain `comment.*`
 * semantics live in the caller). DEFERRED (SPEC §5): external metrics backend,
 * distributed tracing, dashboards, per-tenant rate stats.
 */

/** In-process tally of emitted comment events, keyed by wire `action`. */
const commentEventCounts = new Map<string, number>();

/**
 * Increment the counter for one successfully emitted comment event `action`
 * (`created|updated|closed|reopened|deleted|reassigned`). Pure in-memory; never
 * throws into the caller.
 */
export function incrementCommentEvent(action: string): void {
  commentEventCounts.set(action, (commentEventCounts.get(action) ?? 0) + 1);
}

/**
 * Snapshot reader: a plain object of `action -> count` for the events emitted
 * in this process so far. Returns a copy so callers cannot mutate the tally.
 */
export function getCommentEventCounts(): Record<string, number> {
  return Object.fromEntries(commentEventCounts);
}

/** Test helper: reset the in-process tally (no production caller). */
export function resetCommentEventCounts(): void {
  commentEventCounts.clear();
}
