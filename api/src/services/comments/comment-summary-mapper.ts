import type { Comment } from '@sentropic/comments';
import type { CommentContextType, CommentThreadSummary } from '../context-comments';

/**
 * BR-42d Lot 5 (M-AI-READ) — HOST-SIDE summary mapper (SPEC §1bis #2).
 *
 * Converts the package `Comment` rows returned by `commentStore.listByTarget`
 * into the LIVE AI `CommentThreadSummary` shape (`context-comments.ts:6-21`),
 * reproducing the live thread group-by at `tool-service.ts:1244-1268`
 * BYTE-FOR-BYTE (the Lot-0 `comment-assistant.test.ts` characterization pins
 * this exact key set + grouping):
 *   - root   = earliest row in the thread (rows arrive `createdAt ASC, id ASC`);
 *   - last   = latest row processed;
 *   - count  = number of rows in the thread;
 *   - status = `closed` if ANY row is closed, else `open` (`:1267`);
 *   - assignedTo = FIRST non-null assignee encountered (`:1268`);
 *   - createdBy / createdAt = root row's `author.id` / `createdAt` (`:1252-1253`);
 *   - updatedAt = latest row's `updatedAt` (`:1266`, falls back to prior).
 *
 * The package `CommentThreadSummary` (`types.ts:109-129`) uses `assignee` +
 * `status:'open'|'resolved'` and OMITS `createdBy/createdAt/updatedAt`, so this
 * mapper does NOT consume the package summary — it groups the full `Comment`
 * rows directly (the host already needs them for the `users` label join). NO
 * package edit (SPEC DEC-1).
 *
 * The mapper does NOT join `users`; that stays app-local in `tool-service`.
 */

/**
 * Group `Comment` rows (assumed `createdAt ASC, id ASC` within each thread) into
 * the live AI `CommentThreadSummary[]`, mirroring `tool-service.ts:1244-1268`.
 *
 * Iteration order of threads follows first-seen order across the input rows, so
 * passing the per-target `listByTarget` rows in the live query order preserves
 * the live `Array.from(byThread.values())` ordering before host-side slicing.
 */
export function buildThreadSummariesFromComments(rows: Comment[]): CommentThreadSummary[] {
  const byThread = new Map<string, CommentThreadSummary>();

  for (const row of rows) {
    const key = row.threadId;
    const createdAt = row.createdAt;
    const updatedAt = row.updatedAt ?? null;
    const contextType = (row.target.recordType ?? row.target.kind) as CommentContextType;
    const contextId = row.target.id;
    const sectionKey = row.target.sectionKey ?? null;
    const status = row.state === 'resolved' ? 'closed' : 'open';
    const assignedTo = row.assignedTo ?? null;

    const current = byThread.get(key);
    if (!current) {
      byThread.set(key, {
        threadId: row.threadId,
        contextType,
        contextId,
        sectionKey,
        status,
        assignedTo,
        createdBy: row.author.id,
        createdAt,
        updatedAt,
        messageCount: 1,
        rootMessage: row.body,
        rootMessageAt: createdAt,
        lastMessage: row.body,
        lastMessageAt: createdAt,
      });
    } else {
      current.messageCount += 1;
      current.lastMessage = row.body;
      current.lastMessageAt = createdAt;
      current.updatedAt = updatedAt ?? current.updatedAt;
      current.status = status === 'closed' ? 'closed' : current.status;
      if (!current.assignedTo && assignedTo) current.assignedTo = assignedTo;
    }
  }

  return Array.from(byThread.values());
}
