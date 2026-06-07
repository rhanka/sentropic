/**
 * comments/utils.ts
 *
 * Generic comment utility functions — pure TS, zero sentropic domain strings.
 * These are the subset of comment-adapter.ts helpers that are generic enough
 * to live in the package (no SECTION_LABEL_KEYS, no domain enum).
 *
 * The app-side comment-adapter.ts continues to export them for UI consumers
 * that already import from there; this file is the canonical package-internal
 * source.
 */

import type { MentionMember, CommentItem, CommentThreadSummary } from './types.js';

export const getInitials = (label: string): string => {
  const parts = label.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
};

export const getCommentAuthorLabel = (
  comment: Pick<CommentItem, 'created_by' | 'created_by_user'>,
): string =>
  comment.created_by_user?.displayName ||
  comment.created_by_user?.email ||
  comment.created_by;

export const getMentionLabel = (member: MentionMember): string =>
  member.displayName || member.email || member.userId;

export const isCommentByUser = (
  comment: Pick<CommentItem, 'created_by' | 'created_by_user'>,
  user: { id?: string | null; email?: string | null } | null | undefined,
): boolean => {
  if (!user) return false;
  if (user.id && comment.created_by === user.id) return true;
  if (user.email && comment.created_by === user.email) return true;
  if (user.id && comment.created_by_user?.id === user.id) return true;
  if (user.email && comment.created_by_user?.email === user.email) return true;
  return false;
};

export const isAiComment = (
  comment: Pick<CommentItem, 'tool_call_id'>,
): boolean => Boolean(comment.tool_call_id);

export const getMentionCandidate = (
  text: string,
): { start: number; end: number; query: string } | null => {
  if (!text) return null;
  if (/\s$/.test(text)) return null;
  const match = /(^|[\s([{])@([^\s@]{0,32})$/.exec(text);
  if (!match) return null;
  const start = (match.index ?? 0) + match[1].length;
  return { start, end: text.length, query: match[2] ?? '' };
};

export const getMentionMatches = <T extends MentionMember>(
  members: readonly T[],
  query: string,
  limit = 6,
): T[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return members.slice(0, limit);
  return members
    .filter((member) => getMentionLabel(member).toLowerCase().includes(needle))
    .slice(0, limit);
};

export const findAssignedMentionFromText = <T extends MentionMember>(
  text: string,
  members: readonly T[],
): T | null => {
  if (!text || members.length === 0) return null;
  const haystack = text.toLowerCase();
  let best: { member: T; index: number } | null = null;
  for (const member of members) {
    const label = getMentionLabel(member).toLowerCase();
    const index = haystack.lastIndexOf(`@${label}`);
    if (index >= 0 && (!best || index > best.index)) {
      best = { member, index };
    }
  }
  return best?.member ?? null;
};

export const isSameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

export const formatCommentTimestamp = (input: {
  value: string | null | undefined;
  now: Date;
  yesterdayLabel: string;
  timeFormatter: Pick<Intl.DateTimeFormat, 'format'>;
  dateFormatter: Pick<Intl.DateTimeFormat, 'format'>;
}): string => {
  if (!input.value) return '';
  const date = new Date(input.value);
  if (Number.isNaN(date.getTime())) return '';
  if (isSameDay(date, input.now)) return input.timeFormatter.format(date);
  const yesterday = new Date(input.now);
  yesterday.setDate(input.now.getDate() - 1);
  if (isSameDay(date, yesterday)) {
    return `${input.yesterdayLabel} ${input.timeFormatter.format(date)}`;
  }
  return `${input.dateFormatter.format(date)} ${input.timeFormatter.format(date)}`;
};

export const buildCommentThreads = <T extends CommentItem>(
  items: readonly T[],
): { threads: CommentThreadSummary[]; map: Map<string, T[]> } => {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const threadId = item.thread_id;
    if (!threadId) continue;
    map.set(threadId, [...(map.get(threadId) ?? []), item]);
  }

  for (const [threadId, threadItems] of map.entries()) {
    map.set(
      threadId,
      [...threadItems].sort((left, right) =>
        String(left.created_at ?? '') < String(right.created_at ?? '') ? -1 : 1,
      ),
    );
  }

  const threads = Array.from(map.entries()).map(([threadId, threadItems]) => {
    const last = threadItems[threadItems.length - 1];
    const root = threadItems[0] ?? null;
    return {
      id: threadId,
      sectionKey: last?.section_key || null,
      count: threadItems.length,
      lastAt: last?.created_at ?? '',
      preview: last?.content ?? '',
      authorLabel: last ? getCommentAuthorLabel(last) : '',
      status: (root?.status ?? 'open') as 'open' | 'closed',
      assignedTo: root?.assigned_to ?? null,
      rootId: root?.id ?? threadId,
      createdBy: root?.created_by ?? '',
    };
  });
  threads.sort((left, right) => (left.lastAt < right.lastAt ? 1 : -1));
  return { threads, map };
};
