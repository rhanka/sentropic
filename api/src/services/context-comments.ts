import { callOpenAIResponseStream } from './openai';
import { defaultPrompts } from '../config/default-prompts';

export type CommentContextType = 'organization' | 'folder' | 'usecase' | 'matrix' | 'executive_summary';

export type CommentThreadSummary = {
  threadId: string;
  contextType: CommentContextType;
  contextId: string;
  sectionKey: string | null;
  status: 'open' | 'closed';
  assignedTo: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string | null;
  messageCount: number;
  rootMessage: string;
  rootMessageAt: string;
  lastMessage: string;
  lastMessageAt: string;
};

export type CommentUserLabel = {
  id: string;
  email: string | null;
  displayName: string | null;
};

export type CommentResolutionProposal = {
  summary_markdown: string;
  actions: Array<{
    thread_id: string;
    action: 'close' | 'reassign' | 'note';
    reassign_to?: string | null;
    note?: string | null;
  }>;
  confirmation_prompt: string;
  confirmation_options: string[];
};

const DEFAULT_PROMPT_ID = 'comment_resolution_assistant';

const safeTruncate = (value: string, max = 600): string => {
  if (!value) return '';
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
};

const normalizeThreadsForPrompt = (threads: CommentThreadSummary[]) =>
  threads.map((t) => ({
    thread_id: t.threadId,
    context_type: t.contextType,
    context_id: t.contextId,
    section_key: t.sectionKey,
    status: t.status,
    assigned_to: t.assignedTo,
    created_by: t.createdBy,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
    message_count: t.messageCount,
    root_message: safeTruncate(t.rootMessage, 700),
    root_message_at: t.rootMessageAt,
    last_message: safeTruncate(t.lastMessage, 700),
    last_message_at: t.lastMessageAt
  }));

export async function generateCommentResolutionProposal(opts: {
  threads: CommentThreadSummary[];
  users: CommentUserLabel[];
  contextLabel: string;
  currentUserId: string;
  currentUserRole: string | null;
  maxActions?: number;
}): Promise<CommentResolutionProposal> {
  if (!opts.threads || opts.threads.length === 0) {
    return {
      summary_markdown: 'No open comment threads were found in the current scope.',
      actions: [],
      confirmation_prompt: 'Nothing to resolve. Do you want to do anything else?',
      confirmation_options: ['No']
    };
  }

  const promptTemplate =
    defaultPrompts.find((p) => p.id === DEFAULT_PROMPT_ID)?.content ||
    `You are a comment resolution assistant. Produce a JSON proposal with clear next actions.`;

  const prompt = promptTemplate
    .replace('{{context_label}}', opts.contextLabel || 'Current context')
    .replace('{{current_user_id}}', opts.currentUserId || '')
    .replace('{{current_user_role}}', opts.currentUserRole || '')
    .replace('{{max_actions}}', String(opts.maxActions ?? 5))
    .replace('{{threads_json}}', JSON.stringify(normalizeThreadsForPrompt(opts.threads), null, 2))
    .replace('{{users_json}}', JSON.stringify(opts.users ?? [], null, 2));

  let raw = '';
  for await (const event of callOpenAIResponseStream({
    messages: [{ role: 'system', content: prompt }],
    responseFormat: 'json_object',
    maxOutputTokens: 800
  })) {
    if (event.type === 'content_delta') {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const delta = typeof data.delta === 'string' ? data.delta : '';
      if (delta) raw += delta;
    }
    if (event.type === 'error') {
      const data = (event.data ?? {}) as Record<string, unknown>;
      const msg = typeof data.message === 'string' ? data.message : 'OpenAI error';
      throw new Error(msg);
    }
  }

  if (!raw.trim()) throw new Error('Empty response from comment assistant');
  const parsed = JSON.parse(raw) as CommentResolutionProposal;
  return parsed;
}
