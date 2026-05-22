/**
 * @sentropic/flow — pure JSON helpers used by the JobQueue adapter
 * when reading rows out of the underlying queue table.
 *
 * Real reorganization (BR-26 Lot 7): these used to live as
 * top-level functions in `api/src/services/queue-manager.ts`
 * (`parseJsonField`, `sanitizeJobResultForPublic`). They are pure —
 * no DB, no I/O, no app-specific job type knowledge — and belong
 * with the `JobQueue` port definition.
 */

/**
 * Parse a value that may be a JSON string, a plain object, or `null`.
 * Returns `null` for any non-parseable input.
 */
export function parseJsonField<T = unknown>(value: unknown): T | null {
  if (value == null) return null;
  if (typeof value === 'object') return value as T;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Strip large binary payloads from a job result before returning it
 * to API consumers. Currently this means dropping `contentBase64`
 * and surfacing a boolean `hasContent` flag instead.
 */
export function sanitizeJobResultForPublic(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const copy = { ...(result as Record<string, unknown>) };
  if (typeof copy.contentBase64 === 'string') {
    delete copy.contentBase64;
    copy.hasContent = true;
  }
  return copy;
}
