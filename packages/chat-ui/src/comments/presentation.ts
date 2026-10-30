import type { MentionMember, CommentItem } from './types.js';

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

