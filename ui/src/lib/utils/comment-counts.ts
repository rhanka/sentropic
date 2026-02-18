type CommentListItem = {
  thread_id?: string | null;
  status?: string | null;
  section_key?: string | null;
};

export function buildOpenCommentCounts(items: CommentListItem[] | null | undefined): Record<string, number> {
  const counts: Record<string, number> = {};
  const threads = new Map<string, { status: string; count: number; sectionKey: string | null }>();

  for (const item of items ?? []) {
    const threadId = item.thread_id;
    if (!threadId) continue;
    const existing = threads.get(threadId);
    if (!existing) {
      threads.set(threadId, {
        status: item.status || 'open',
        count: 1,
        sectionKey: item.section_key || null,
      });
    } else {
      threads.set(threadId, { ...existing, count: existing.count + 1 });
    }
  }

  for (const thread of threads.values()) {
    if (thread.status === 'closed') continue;
    const key = thread.sectionKey || 'root';
    counts[key] = (counts[key] || 0) + thread.count;
  }

  return counts;
}
