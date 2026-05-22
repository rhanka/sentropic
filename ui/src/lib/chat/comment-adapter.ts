export type MentionMemberLike = {
  userId: string;
  email?: string | null;
  displayName?: string | null;
};

export type CommentUserLike = {
  id?: string | null;
  email?: string | null;
  displayName?: string | null;
};

export type CommentLike = {
  id?: string;
  thread_id?: string | null;
  section_key?: string | null;
  content?: string | null;
  status?: string | null;
  assigned_to?: string | null;
  created_by: string;
  created_at?: string;
  updated_at?: string | null;
  tool_call_id?: string | null;
  created_by_user?: CommentUserLike | null;
};

export type CommentThreadSummary = {
  id: string;
  sectionKey: string | null;
  count: number;
  lastAt: string;
  preview: string;
  authorLabel: string;
  status: 'open' | 'closed';
  assignedTo: string | null;
  rootId: string;
  createdBy: string;
};

const SECTION_LABEL_KEYS: Record<string, Record<string, string>> = {
  usecase: {
    name: 'common.name',
    description: 'chat.sections.usecase.description',
    problem: 'chat.sections.usecase.problem',
    solution: 'chat.sections.usecase.solution',
    benefits: 'chat.sections.usecase.benefits',
    constraints: 'chat.sections.usecase.constraints',
    risks: 'chat.sections.usecase.risks',
    metrics: 'chat.sections.usecase.metrics',
    nextSteps: 'chat.sections.usecase.nextSteps',
    technologies: 'chat.sections.usecase.technologies',
    dataSources: 'chat.sections.usecase.dataSources',
    dataObjects: 'chat.sections.usecase.dataObjects',
    valueScores: 'chat.sections.usecase.valueScores',
    complexityScores: 'chat.sections.usecase.complexityScores',
    references: 'chat.sections.usecase.references',
    contact: 'chat.sections.usecase.contact',
    domain: 'chat.sections.usecase.domain',
    deadline: 'chat.sections.usecase.deadline',
  },
  organization: {
    name: 'common.name',
    industry: 'organization.fields.industry',
    size: 'chat.sections.organization.size',
    technologies: 'chat.sections.organization.technologies',
    products: 'chat.sections.organization.products',
    processes: 'chat.sections.organization.processes',
    kpis: 'chat.sections.organization.kpis',
    challenges: 'chat.sections.organization.challenges',
    objectives: 'chat.sections.organization.objectives',
    references: 'chat.sections.organization.references',
  },
  folder: {
    description: 'chat.sections.folder.description',
    name: 'chat.sections.folder.name',
  },
  executive_summary: {
    name: 'chat.sections.folder.name',
    introduction: 'chat.sections.executiveSummary.introduction',
    analyse: 'chat.sections.executiveSummary.analysis',
    analysis: 'chat.sections.executiveSummary.analysis',
    recommandation: 'chat.sections.executiveSummary.recommendations',
    recommendations: 'chat.sections.executiveSummary.recommendations',
    synthese_executive: 'chat.sections.executiveSummary.summary',
    synthese: 'chat.sections.executiveSummary.summary',
    summary: 'chat.sections.executiveSummary.summary',
    references: 'chat.sections.executiveSummary.references',
  },
};

export const getCommentSectionLabel = (
  type: string | null,
  key: string | null,
  translate: (key: string) => string,
): string | null => {
  if (!type) return null;
  if (!key) return translate('common.general');
  const i18nKey = SECTION_LABEL_KEYS[type]?.[key];
  return i18nKey ? translate(i18nKey) : key;
};

export const getInitials = (label: string): string => {
  const parts = label.trim().split(/\s+/);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  return initials || '?';
};

export const getCommentAuthorLabel = (comment: CommentLike): string =>
  comment.created_by_user?.displayName ||
  comment.created_by_user?.email ||
  comment.created_by;

export const getMentionLabel = (member: MentionMemberLike): string =>
  member.displayName || member.email || member.userId;

export const isCommentByUser = (
  comment: CommentLike,
  user: CommentUserLike | null | undefined,
): boolean => {
  if (!user) return false;
  if (user.id && comment.created_by === user.id) return true;
  if (user.email && comment.created_by === user.email) return true;
  if (user.id && comment.created_by_user?.id === user.id) return true;
  if (user.email && comment.created_by_user?.email === user.email) return true;
  return false;
};

export const isAiComment = (comment: CommentLike): boolean =>
  Boolean(comment.tool_call_id);

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

export const getMentionMatches = <T extends MentionMemberLike>(
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

export const findAssignedMentionFromText = <T extends MentionMemberLike>(
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

export const buildCommentThreads = <T extends CommentLike>(
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
