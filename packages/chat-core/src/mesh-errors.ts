/**
 * BR14b Lot 21b — mesh-level error classification helpers.
 *
 * Verbatim port of the `isPreviousResponseNotFoundError` predicate
 * inlined in `api/src/services/chat-service.ts` (line 2868-2874 pre-Lot
 * 21b). The predicate inspects a mesh-side error message and decides
 * whether the failure was caused by a stale Responses-API
 * `previous_response_id` reference — in which case the orchestration
 * loop must retry the current iteration without a previous response.
 *
 * Lives next to `./mesh-port.ts` so the predicate stays adjacent to the
 * dispatch surface it complements. Chat-core stays contracts-free: the
 * helper only inspects a string and depends on no runtime infrastructure.
 */

/**
 * Returns `true` when the supplied error message looks like a mesh-side
 * "previous response not found" failure. Matches the case-insensitive
 * pattern used by the chat-service.ts inline predicate pre-Lot 21b so
 * the migrated `ChatRuntime.consumeAssistantStream` retry path stays
 * byte-identical to the legacy behaviour.
 */
export function isPreviousResponseNotFoundError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('previous response') &&
    normalized.includes('not found')
  );
}
