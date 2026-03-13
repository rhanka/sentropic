import { and, asc, desc, eq, sql, inArray, gt, or } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { chatContexts, chatMessageFeedback, chatMessages, chatSessions, chatStreamEvents, contextDocuments, folders, jobQueue } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAI, callOpenAIResponseStream, type StreamEventType } from './llm-runtime';
import {
  getModelCatalogPayload,
  inferProviderFromModelIdWithLegacy,
  modelSupportsReasoning,
  resolveDefaultSelection,
} from './model-catalog';
import { getNextSequence, readStreamEvents, writeStreamEvent } from './stream-service';
import { settingsService } from './settings';
import type OpenAI from 'openai';
import { getOpenAITransportMode } from './provider-connections';
import { defaultPrompts } from '../config/default-prompts';
import {
  readUseCaseTool,
  updateUseCaseFieldTool,
  useCaseGetTool,
  useCaseUpdateTool,
  webSearchTool,
  webExtractTool,
  searchWeb,
  extractUrlContent,
  organizationsListTool,
  organizationGetTool,
  organizationUpdateTool,
  foldersListTool,
  folderGetTool,
  folderUpdateTool,
  useCasesListTool,
  executiveSummaryGetTool,
  executiveSummaryUpdateTool,
  matrixGetTool,
  matrixUpdateTool,
  documentsTool,
  historyAnalyzeTool,
  commentAssistantTool,
  planTool
} from './tools';
import { toolService } from './tool-service';
import { todoOrchestrationService } from './todo-orchestration';
import { ensureWorkspaceForUser } from './workspace-service';
import { getWorkspaceRole, hasWorkspaceRole, isWorkspaceDeleted } from './workspace-access';
import { env } from '../config/env';
import { writeChatGenerationTrace } from './chat-trace';
import { generateCommentResolutionProposal } from './context-comments';
import type { ProviderId } from './provider-runtime';
import {
  buildAssistantMessageHistoryDetails,
  buildChatHistoryTimeline,
  compactChatHistoryTimelineForSummary,
  type ChatHistoryMessage,
  type ChatHistoryTimelineItem,
  type ChatHistoryStreamEvent,
} from './chat-session-history';

export type ChatContextType = 'organization' | 'folder' | 'usecase' | 'executive_summary';

const CHAT_CONTEXT_TYPES = ['organization', 'folder', 'usecase', 'executive_summary'] as const;
function isChatContextType(value: unknown): value is ChatContextType {
  return typeof value === 'string' && (CHAT_CONTEXT_TYPES as readonly string[]).includes(value);
}

export type CommentContextType = 'organization' | 'folder' | 'usecase' | 'matrix' | 'executive_summary';
const COMMENT_CONTEXT_TYPES = ['organization', 'folder', 'usecase', 'matrix', 'executive_summary'] as const;
function isCommentContextType(value: unknown): value is CommentContextType {
  return typeof value === 'string' && (COMMENT_CONTEXT_TYPES as readonly string[]).includes(value);
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export type CreateChatSessionInput = {
  userId: string;
  workspaceId?: string | null;
  primaryContextType?: ChatContextType | null;
  primaryContextId?: string | null;
  title?: string | null;
};

export type CreateChatMessageInput = {
  userId: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  content: string;
  providerId?: ProviderId | null;
  providerApiKey?: string | null;
  model?: string | null;
  primaryContextType?: ChatContextType | null;
  primaryContextId?: string | null;
  contexts?: Array<{ contextType: ChatContextType; contextId: string }>;
  sessionTitle?: string | null;
};

export type LocalToolDefinitionInput = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type VsCodeCodeAgentInstructionFile = {
  path: string;
  content: string;
};

export type VsCodeCodeAgentSystemContext = {
  workingDirectory?: string | null;
  isGitRepo?: boolean | null;
  gitBranch?: string | null;
  platform?: string | null;
  osVersion?: string | null;
  shell?: string | null;
  clientDateIso?: string | null;
  clientTimezone?: string | null;
};

export type VsCodeCodeAgentRuntimePayload = {
  source?: 'vscode' | null;
  workspaceKey?: string | null;
  workspaceLabel?: string | null;
  promptGlobalOverride?: string | null;
  promptWorkspaceOverride?: string | null;
  instructionIncludePatterns?: string[];
  instructionFiles?: VsCodeCodeAgentInstructionFile[];
  systemContext?: VsCodeCodeAgentSystemContext | null;
};

type NormalizedVsCodeCodeAgentSystemContext = {
  workingDirectory: string | null;
  isGitRepo: boolean | null;
  gitBranch: string | null;
  platform: string | null;
  osVersion: string | null;
  shell: string | null;
  clientDateIso: string | null;
  clientTimezone: string | null;
};

type NormalizedVsCodeCodeAgentRuntimePayload = {
  workspaceKey: string | null;
  workspaceLabel: string | null;
  promptGlobalOverride: string | null;
  promptWorkspaceOverride: string | null;
  instructionIncludePatterns: string[];
  instructionFiles: VsCodeCodeAgentInstructionFile[];
  systemContext: NormalizedVsCodeCodeAgentSystemContext | null;
};

export type ChatResumeFromToolOutputs = {
  previousResponseId: string;
  toolOutputs: Array<{
    callId: string;
    output: string;
    name?: string;
    args?: unknown;
  }>;
};

type AwaitingLocalToolState = {
  sequence: number;
  previousResponseId: string;
  pendingLocalToolCalls: Array<{
    id: string;
    name: string;
    args: unknown;
  }>;
  baseToolOutputs: Array<{
    callId: string;
    output: string;
    name?: string;
    args?: unknown;
  }>;
  localToolDefinitions: LocalToolDefinitionInput[];
  vscodeCodeAgent: NormalizedVsCodeCodeAgentRuntimePayload | null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const getDataString = (data: unknown, key: string): string | null => {
  const record = asRecord(data);
  const value = record?.[key];
  return typeof value === 'string' ? value : null;
};

const isValidToolName = (value: string): boolean => /^[a-zA-Z0-9_-]{1,64}$/.test(value);

const parseToolCallArgs = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return {};
  }
};

type TodoRuntimeToolName = 'plan';
type TodoRuntimeToolOperation = 'create' | 'update_plan' | 'update_task';

const TODO_TERMINAL_STATUSES = new Set(['done', 'cancelled']);
const TODO_BLOCKING_STATUSES = new Set(['blocked']);
const BASE_MAX_ITERATIONS = 10;
const TODO_AUTONOMOUS_MAX_ITERATIONS = 60;
const TODO_AUTONOMOUS_EXTENSION_STEP = 10;
const CONTEXT_BUDGET_SOFT_THRESHOLD = 85;
const CONTEXT_BUDGET_HARD_THRESHOLD = 92;
const CONTEXT_BUDGET_DEFAULT_TOKENS = 32_000;
const CONTEXT_BUDGET_OPENAI_GPT5_TOKENS = 128_000;
const CONTEXT_BUDGET_GEMINI_TOKENS = 128_000;
const CONTEXT_SUMMARY_RECENT_MESSAGES = 8;
const CONTEXT_SUMMARY_MAX_CHARS = 32_000;
const CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS = 700;
const CONTEXT_SUMMARY_SYSTEM_MARKER_START = '[CONTEXT_COMPACT_SUMMARY_BEGIN]';
const CONTEXT_SUMMARY_SYSTEM_MARKER_END = '[CONTEXT_COMPACT_SUMMARY_END]';
const CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS = 1;
const CONTEXT_BUDGET_SOFT_ZONE_CODE = 'context_budget_risk';
const CONTEXT_BUDGET_HARD_ZONE_CODE = 'context_budget_blocked';
const VSCODE_CODE_AGENT_INSTRUCTION_FILES_MAX = 16;
const VSCODE_CODE_AGENT_INSTRUCTION_CONTENT_MAX_CHARS = 12_000;
const VSCODE_CODE_AGENT_INSTRUCTION_BLOCK_MAX_CHARS = 48_000;
const VSCODE_CODE_AGENT_SYSTEM_CONTEXT_FIELD_MAX_CHARS = 512;

type SessionTodoRuntimeTask = {
  id: string;
  title: string;
  status: string;
};

type SessionTodoRuntimeSnapshot = {
  todoId: string;
  todoTitle: string;
  status: string;
  tasks: SessionTodoRuntimeTask[];
};

type ChatRuntimeMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string }
  | { role: 'tool'; content: string; tool_call_id: string };

type ContextBudgetZone = 'normal' | 'soft' | 'hard';

type ContextBudgetSnapshot = {
  estimatedTokens: number;
  maxTokens: number;
  occupancyPct: number;
  zone: ContextBudgetZone;
};
const CHAT_CHECKPOINT_CONTEXT_TYPE = 'chat_session_checkpoint';

type ChatCheckpointSummary = {
  id: string;
  title: string;
  anchorMessageId: string;
  anchorSequence: number;
  messageCount: number;
  createdAt: string;
};

type ChatBootstrapStreamEvent = {
  eventType: string;
  data: unknown;
  sequence: number;
  createdAt: Date;
};

type ChatSessionDocumentItem = {
  id: string;
  context_type: 'chat_session';
  context_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  summary?: string | null;
  summary_lang?: string | null;
  created_at?: Date;
  updated_at?: Date | null;
  job_id?: string | null;
};

const normalizeTodoRuntimeStatus = (value: unknown): string =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim().toLowerCase() : 'todo';

const normalizeIntentText = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchesAnyPattern = (text: string, patterns: RegExp[]): boolean =>
  patterns.some((pattern) => pattern.test(text));

const TODO_REPLACEMENT_PATTERNS = [
  /\b(new|another|fresh)\s+(todo|checklist|list)\b/,
  /\b(replace|replacement|restart|reset)\b.*\b(todo|checklist|list)\b/,
  /\b(nouveau|nouvelle|autre)\s+(todo|liste|checklist)\b/,
  /\b(remplace|remplacer|remplacement|recommence|recommencer|reset)\b.*\b(todo|liste|checklist)\b/,
];

const TODO_PROGRESSION_PATTERNS = [
  /\b(go|continue|next|advance|progress|check|mark)\b/,
  /\b(coche|cocher|avance|avancer|progression|progresser|termine|terminer|marque|marquer)\b/,
];

const TODO_GO_SIGNAL_PATTERNS = [
  /^(go|ok|okay|yes|oui|vas y|vas-y|continue)$/i,
  /\b(go ahead|on y va|vas y|vas-y)\b/i,
];

const TODO_STRUCTURAL_MUTATION_PATTERNS = [
  /\b(add|append|insert|remove|delete|drop|replace|rewrite|rename|reorder|re organise|reorganize|split|merge)\b.*\b(todo|checklist|list|task|tasks|item|items|step|steps|plan)\b/,
  /\b(ajoute|ajouter|ajout|retire|retirer|supprime|supprimer|suppression|remplace|remplacer|renomme|renommer|reordonne|reordonner|reorganise|reorganiser|scinde|scinder|fusionne|fusionner)\b.*\b(todo|liste|checklist|tache|taches|item|items|etape|etapes|plan)\b/,
];

const isExplicitTodoReplacementRequest = (message: string): boolean => {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;
  return matchesAnyPattern(normalized, TODO_REPLACEMENT_PATTERNS);
};

const isTodoProgressionIntent = (message: string): boolean => {
  const normalized = normalizeIntentText(message);
  if (!normalized || isExplicitTodoReplacementRequest(message)) return false;
  return matchesAnyPattern(normalized, TODO_PROGRESSION_PATTERNS);
};

const isTodoGoSignal = (message: string): boolean => {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;
  return matchesAnyPattern(normalized, TODO_GO_SIGNAL_PATTERNS);
};

const isExplicitTodoStructuralMutationRequest = (message: string): boolean => {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;
  return (
    isExplicitTodoReplacementRequest(message) ||
    matchesAnyPattern(normalized, TODO_STRUCTURAL_MUTATION_PATTERNS)
  );
};

const toSessionTodoRuntimeSnapshot = (value: unknown): SessionTodoRuntimeSnapshot | null => {
  const record = asRecord(value);
  if (!record) return null;

  const todo = asRecord(record.todo);
  const activeTodo = asRecord(record.activeTodo);
  const todoId = String(record.todoId ?? todo?.id ?? activeTodo?.id ?? '').trim();
  if (!todoId) return null;

  const todoTitle = String(todo?.title ?? activeTodo?.title ?? '').trim();
  const status = normalizeTodoRuntimeStatus(
    record.status ?? record.todoStatus ?? todo?.derivedStatus ?? activeTodo?.derivedStatus,
  );
  const tasksRaw = Array.isArray(record.tasks) ? record.tasks : [];
  const tasks: SessionTodoRuntimeTask[] = tasksRaw
    .map((entry) => {
      const task = asRecord(entry);
      if (!task) return null;
      const title = String(task.title ?? '').trim();
      const id = String(task.id ?? '').trim();
      if (!title && !id) return null;
      return {
        id,
        title: title || '(untitled task)',
        status: normalizeTodoRuntimeStatus(task.status ?? task.derivedStatus),
      };
    })
    .filter((entry): entry is SessionTodoRuntimeTask => entry !== null);

  return {
    todoId,
    todoTitle,
    status,
    tasks,
  };
};

const resolveTodoRuntimeOperation = (
  _toolName: TodoRuntimeToolName,
  operationHint?: TodoRuntimeToolOperation | null,
): TodoRuntimeToolOperation => operationHint ?? 'update_plan';

const normalizeTodoRuntimeToolResult = (
  toolName: TodoRuntimeToolName,
  toolCallId: string,
  rawResult: unknown,
  operationHint?: TodoRuntimeToolOperation | null,
): Record<string, unknown> => {
  const operation = resolveTodoRuntimeOperation(toolName, operationHint);
  const base = asRecord(rawResult) ?? {};
  const normalized: Record<string, unknown> = { ...base };
  const todoRuntime: Record<string, unknown> = {
    tool: toolName,
    operation,
    toolCallId,
    status: typeof base.status === 'string' ? base.status : 'completed',
  };

  if (operation === 'create') {
    if (typeof base.todoId === 'string' && base.todoId.trim().length > 0) {
      todoRuntime.todoId = base.todoId;
    }
    if (typeof base.planId === 'string') {
      todoRuntime.planId = base.planId;
    } else if (base.planId === null) {
      todoRuntime.planId = null;
    }
    if (Array.isArray(base.tasks)) {
      todoRuntime.tasks = base.tasks;
    }
    if (typeof base.taskCount === 'number') {
      todoRuntime.taskCount = base.taskCount;
    }
    if (typeof base.code === 'string') {
      todoRuntime.code = base.code;
    }
    if (typeof base.message === 'string') {
      todoRuntime.message = base.message;
    }
    const activeTodo = asRecord(base.activeTodo);
    if (activeTodo) {
      todoRuntime.activeTodo = activeTodo;
      if (typeof activeTodo.id === 'string') {
        todoRuntime.todoId = activeTodo.id;
      }
      if (
        typeof activeTodo.derivedStatus === 'string' &&
        !todoRuntime.todoStatus
      ) {
        todoRuntime.todoStatus = activeTodo.derivedStatus;
      }
    }
  } else if (operation === 'update_plan') {
    const todo = asRecord(base.todo);
    if (todo) {
      todoRuntime.todo = todo;
      if (typeof todo.id === 'string') {
        todoRuntime.todoId = todo.id;
      }
      if (typeof todo.planId === 'string') {
        todoRuntime.planId = todo.planId;
      } else if (todo.planId === null) {
        todoRuntime.planId = null;
      }
      if (typeof todo.derivedStatus === 'string') {
        todoRuntime.todoStatus = todo.derivedStatus;
      }
    }
  } else if (operation === 'update_task') {
    const task = asRecord(base.task);
    if (task) {
      todoRuntime.task = task;
      if (typeof task.todoId === 'string') {
        todoRuntime.todoId = task.todoId;
      }
    }
    if (typeof base.todoStatus === 'string') {
      todoRuntime.todoStatus = base.todoStatus;
    }
    if (typeof base.planStatus === 'string') {
      todoRuntime.planStatus = base.planStatus;
    } else if (base.planStatus === null) {
      todoRuntime.planStatus = null;
    }
    if (typeof base.runId === 'string') {
      todoRuntime.runId = base.runId;
    }
    if (typeof base.runStatus === 'string') {
      todoRuntime.runStatus = base.runStatus;
    }
    if (typeof base.runTaskId === 'string') {
      todoRuntime.runTaskId = base.runTaskId;
    }
  }

  normalized.todoRuntime = todoRuntime;
  return normalized;
};

const toBudgetString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value ?? '');
  }
};

const inferContextBudgetMaxTokens = (
  providerId: ProviderId,
  modelId: string | null | undefined,
): number => {
  const model = String(modelId ?? '').trim().toLowerCase();
  if (providerId === 'gemini') return CONTEXT_BUDGET_GEMINI_TOKENS;
  if (model.startsWith('gpt-5')) return CONTEXT_BUDGET_OPENAI_GPT5_TOKENS;
  return CONTEXT_BUDGET_DEFAULT_TOKENS;
};

const estimateTokenCountFromChars = (charCount: number): number =>
  Math.max(1, Math.ceil(charCount / 4));

const resolveBudgetZone = (occupancyPct: number): ContextBudgetZone => {
  if (occupancyPct >= CONTEXT_BUDGET_HARD_THRESHOLD) return 'hard';
  if (occupancyPct >= CONTEXT_BUDGET_SOFT_THRESHOLD) return 'soft';
  return 'normal';
};

const estimateContextBudget = (input: {
  messages: ChatRuntimeMessage[];
  tools?: unknown;
  rawInput?: unknown[] | null;
  providerId: ProviderId;
  modelId: string | null | undefined;
}): ContextBudgetSnapshot => {
  const maxTokens = inferContextBudgetMaxTokens(input.providerId, input.modelId);
  const messageChars = input.messages.reduce<number>((acc, message) => {
    const base = `${message.role}:${toBudgetString(message.content)}`;
    return acc + base.length;
  }, 0);
  const toolsChars = input.tools ? toBudgetString(input.tools).length : 0;
  const rawInputChars = Array.isArray(input.rawInput)
    ? input.rawInput.reduce<number>(
        (acc, entry) => acc + toBudgetString(entry).length,
        0,
      )
    : 0;
  const estimatedTokens = estimateTokenCountFromChars(
    messageChars + toolsChars + rawInputChars,
  );
  const occupancyPct = Math.min(
    100,
    Math.max(0, Math.round((estimatedTokens / maxTokens) * 100)),
  );
  const zone: ContextBudgetZone = resolveBudgetZone(occupancyPct);
  return {
    estimatedTokens,
    maxTokens,
    occupancyPct,
    zone,
  };
};

const estimateToolResultProjectionChars = (
  toolName: string,
  args: Record<string, unknown>,
): number => {
  if (toolName === 'documents') {
    const action = typeof args.action === 'string' ? args.action : '';
    if (action === 'get_content') {
      const maxChars =
        typeof args.maxChars === 'number' && Number.isFinite(args.maxChars)
          ? Math.max(2000, Math.floor(args.maxChars))
          : 70_000;
      return maxChars;
    }
    if (action === 'analyze') return 20_000;
    if (action === 'list' || action === 'get_summary') return 8_000;
  }
  if (toolName === 'web_extract') {
    const urls = Array.isArray(args.urls)
      ? args.urls.length
      : args.url
        ? 1
        : 0;
    const count = Math.max(1, urls);
    return Math.min(180_000, count * 40_000);
  }
  if (toolName === 'history_analyze') return 16_000;
  if (toolName === 'web_search') return 8_000;
  if (toolName === 'plan') return 5_000;
  return 6_000;
};

const stripCompactSummaryFromSystemPrompt = (prompt: string): string => {
  const startIndex = prompt.indexOf(CONTEXT_SUMMARY_SYSTEM_MARKER_START);
  const endIndex = prompt.indexOf(CONTEXT_SUMMARY_SYSTEM_MARKER_END);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    return prompt.trim();
  }
  const before = prompt.slice(0, startIndex).trim();
  const after = prompt
    .slice(endIndex + CONTEXT_SUMMARY_SYSTEM_MARKER_END.length)
    .trim();
  return `${before}\n\n${after}`.trim();
};

const injectCompactSummaryInSystemPrompt = (prompt: string, summary: string): string => {
  const cleanPrompt = stripCompactSummaryFromSystemPrompt(prompt);
  const cleanSummary = summary.trim();
  if (!cleanSummary) return cleanPrompt;
  return [
    cleanPrompt,
    '',
    CONTEXT_SUMMARY_SYSTEM_MARKER_START,
    'Conversation context summary (auto-generated for context budget compaction):',
    cleanSummary,
    CONTEXT_SUMMARY_SYSTEM_MARKER_END,
  ].join('\n').trim();
};

const formatConversationForSummary = (messages: ChatRuntimeMessage[]): string =>
  messages
    .map((message, index) => {
      const role = String(message.role || 'unknown').toUpperCase();
      const content = toBudgetString(message.content).slice(
        0,
        CONTEXT_SUMMARY_MAX_CHARS,
      );
      return `#${index + 1} ${role}\n${content}`;
    })
    .join('\n\n');

const compactConversationContext = async (input: {
  messages: ChatRuntimeMessage[];
  providerId: ProviderId;
  modelId: string | null | undefined;
  userId: string;
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<{
  compactedMessages: ChatRuntimeMessage[];
  summary: string;
  summarizedCount: number;
}> => {
  const [systemMessage, ...conversation] = input.messages;
  const safeSystemMessage =
    systemMessage?.role === 'system'
      ? systemMessage
      : ({ role: 'system', content: '' } as const);
  const keepTailCount =
    conversation.length > CONTEXT_SUMMARY_RECENT_MESSAGES
      ? CONTEXT_SUMMARY_RECENT_MESSAGES
      : Math.min(2, conversation.length);
  if (conversation.length <= keepTailCount) {
    return {
      compactedMessages: input.messages,
      summary: '',
      summarizedCount: 0,
    };
  }

  const summaryTarget = conversation.slice(
    0,
    Math.max(0, conversation.length - keepTailCount),
  );
  const keepTail = conversation.slice(-keepTailCount);
  const summaryInput = formatConversationForSummary(summaryTarget);
  const summaryPrompt = [
    'Summarize the conversation history for continuity.',
    '- Keep key user goals, constraints, and unresolved questions.',
    '- Keep factual tool outputs/evidence already established.',
    '- Keep language concise, neutral, and faithful.',
    '- Return plain markdown bullet points (max 12 bullets).',
    '',
    summaryInput,
  ].join('\n');

  const summaryResponse = await callOpenAI({
    providerId: input.providerId,
    model:
      input.providerId === 'gemini'
        ? 'gemini-3.1-flash-lite'
        : 'gpt-4.1-nano',
    userId: input.userId,
    workspaceId: input.workspaceId,
    messages: [{ role: 'user', content: summaryPrompt }],
    maxOutputTokens: CONTEXT_SUMMARY_MAX_OUTPUT_TOKENS,
    signal: input.signal,
  });
  const summary = String(
    summaryResponse.choices?.[0]?.message?.content ?? '',
  ).trim();
  const nextSystemContent = injectCompactSummaryInSystemPrompt(
    safeSystemMessage.content,
    summary,
  );
  return {
    compactedMessages: [
      {
        role: 'system',
        content: nextSystemContent,
      },
      ...keepTail,
    ],
    summary,
    summarizedCount: summaryTarget.length,
  };
};

export class ChatService {
  private normalizeMessageContexts(
    input: Pick<CreateChatMessageInput, 'contexts' | 'primaryContextType' | 'primaryContextId'>
  ): Array<{ contextType: ChatContextType; contextId: string }> {
    const normalized: Array<{ contextType: ChatContextType; contextId: string }> = [];
    const seen = new Set<string>();
    if (Array.isArray(input.contexts)) {
      for (const c of input.contexts) {
        if (!c || !isChatContextType(c.contextType) || typeof c.contextId !== 'string' || !c.contextId) continue;
        const key = `${c.contextType}:${c.contextId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        normalized.push({ contextType: c.contextType, contextId: c.contextId });
      }
    }
    if (normalized.length === 0 && input.primaryContextType && input.primaryContextId) {
      if (isChatContextType(input.primaryContextType) && typeof input.primaryContextId === 'string') {
        normalized.push({ contextType: input.primaryContextType, contextId: input.primaryContextId });
      }
    }
    return normalized;
  }
  private safeTruncate(text: string, maxLen: number): string {
    if (!text) return '';
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + '\n…(tronqué)…';
  }

  private safeJson(value: unknown, maxLen: number): string {
    try {
      const raw = typeof value === 'string' ? value : JSON.stringify(value);
      return this.safeTruncate(raw, maxLen);
    } catch {
      return this.safeTruncate(String(value), maxLen);
    }
  }

  private buildToolDigest(executed: Array<{ name: string; result: unknown }>): string {
    if (!executed.length) return '(aucun outil exécuté)';
    // On limite agressivement pour éviter des prompts énormes (ex: web_extract).
    const parts: string[] = [];
    const maxPerTool = 4000;
    const maxTotal = 12000;
    for (const t of executed) {
      const block = `- ${t.name}:\n${this.safeJson(t.result, maxPerTool)}`;
      parts.push(block);
      if (parts.join('\n\n').length > maxTotal) break;
    }
    return this.safeTruncate(parts.join('\n\n'), maxTotal);
  }

  private serializeToolOutput(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return JSON.stringify({ value: String(value) });
    }
  }

  private normalizeLocalToolDefinitions(
    definitions?: LocalToolDefinitionInput[],
  ): OpenAI.Chat.Completions.ChatCompletionTool[] {
    const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];
    const seen = new Set<string>();

    for (const item of definitions ?? []) {
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (!name || !isValidToolName(name) || seen.has(name)) continue;

      const description =
        typeof item?.description === 'string' && item.description.trim()
          ? item.description.trim()
          : `Local tool ${name}`;
      const parameters =
        asRecord(item?.parameters) ?? ({ type: 'object', properties: {}, required: [] } as Record<string, unknown>);

      tools.push({
        type: 'function',
        function: {
          name,
          description,
          parameters: parameters as OpenAI.FunctionParameters
        }
      });
      seen.add(name);
    }

    return tools;
  }

  private normalizeVsCodeCodeAgentPayload(
    input?: VsCodeCodeAgentRuntimePayload | null,
  ): NormalizedVsCodeCodeAgentRuntimePayload | null {
    if (!input || typeof input !== 'object') return null;
    const raw = input as Record<string, unknown>;
    const source =
      typeof input.source === 'string'
        ? input.source
        : (typeof raw.source === 'string' ? raw.source : null);
    if (source && source !== 'vscode') return null;

    const normalizeNullable = (value: unknown): string | null => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed.length > 0 ? trimmed : null;
    };
    const normalizeBoundedNullable = (
      value: unknown,
      maxChars = VSCODE_CODE_AGENT_SYSTEM_CONTEXT_FIELD_MAX_CHARS,
    ): string | null => {
      const normalized = normalizeNullable(value);
      if (!normalized) return null;
      return normalized.slice(0, maxChars);
    };

    const instructionIncludePatternsRaw = Array.isArray(input.instructionIncludePatterns)
      ? input.instructionIncludePatterns
      : (Array.isArray(raw.instruction_include_patterns)
          ? (raw.instruction_include_patterns as string[])
          : []);
    const instructionIncludePatterns = Array.isArray(instructionIncludePatternsRaw)
      ? instructionIncludePatternsRaw
          .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
          .filter((entry) => entry.length > 0)
          .slice(0, 64)
      : [];

    const instructionFilesRaw = Array.isArray(input.instructionFiles)
      ? input.instructionFiles
      : (Array.isArray(raw.instruction_files)
          ? (raw.instruction_files as VsCodeCodeAgentInstructionFile[])
          : []);
    const instructionFiles = Array.isArray(instructionFilesRaw)
      ? instructionFilesRaw
          .map((entry) => {
            const path = typeof entry?.path === 'string' ? entry.path.trim() : '';
            const content = typeof entry?.content === 'string' ? entry.content : '';
            if (!path || !content.trim()) return null;
            return {
              path: path.slice(0, 512),
              content: this.safeTruncate(
                content.trim(),
                VSCODE_CODE_AGENT_INSTRUCTION_CONTENT_MAX_CHARS,
              ),
            };
          })
          .filter((entry): entry is VsCodeCodeAgentInstructionFile => entry !== null)
          .slice(0, VSCODE_CODE_AGENT_INSTRUCTION_FILES_MAX)
      : [];

    const systemContextRaw =
      asRecord(input.systemContext) ??
      asRecord(raw.system_context) ??
      null;
    const systemContext: NormalizedVsCodeCodeAgentSystemContext | null =
      systemContextRaw
        ? {
            workingDirectory: normalizeBoundedNullable(
              systemContextRaw.workingDirectory ?? systemContextRaw.working_directory,
            ),
            isGitRepo:
              typeof (systemContextRaw.isGitRepo ?? systemContextRaw.is_git_repo) ===
              'boolean'
                ? Boolean(
                    systemContextRaw.isGitRepo ?? systemContextRaw.is_git_repo,
                  )
                : null,
            gitBranch: normalizeBoundedNullable(
              systemContextRaw.gitBranch ?? systemContextRaw.git_branch,
            ),
            platform: normalizeBoundedNullable(systemContextRaw.platform),
            osVersion: normalizeBoundedNullable(
              systemContextRaw.osVersion ?? systemContextRaw.os_version,
            ),
            shell: normalizeBoundedNullable(systemContextRaw.shell),
            clientDateIso: normalizeBoundedNullable(
              systemContextRaw.clientDateIso ?? systemContextRaw.client_date_iso,
            ),
            clientTimezone: normalizeBoundedNullable(
              systemContextRaw.clientTimezone ?? systemContextRaw.client_timezone,
            ),
          }
        : null;
    const hasSystemContextSignal = Boolean(
      systemContext &&
        (systemContext.workingDirectory ||
          systemContext.isGitRepo !== null ||
          systemContext.gitBranch ||
          systemContext.platform ||
          systemContext.osVersion ||
          systemContext.shell ||
          systemContext.clientDateIso ||
          systemContext.clientTimezone),
    );

    const payload: NormalizedVsCodeCodeAgentRuntimePayload = {
      workspaceKey: normalizeNullable(input.workspaceKey ?? raw.workspace_key),
      workspaceLabel: normalizeNullable(
        input.workspaceLabel ?? raw.workspace_label,
      ),
      promptGlobalOverride: normalizeNullable(
        input.promptGlobalOverride ?? raw.prompt_global_override,
      ),
      promptWorkspaceOverride: normalizeNullable(
        input.promptWorkspaceOverride ?? raw.prompt_workspace_override,
      ),
      instructionIncludePatterns,
      instructionFiles,
      systemContext: hasSystemContextSignal ? systemContext : null,
    };

    const hasSignal = Boolean(
      payload.workspaceKey ||
        payload.workspaceLabel ||
        payload.promptGlobalOverride ||
        payload.promptWorkspaceOverride ||
        payload.instructionIncludePatterns.length > 0 ||
        payload.instructionFiles.length > 0 ||
        payload.systemContext ||
        source === 'vscode',
    );
    return hasSignal ? payload : null;
  }

  private renderVsCodeInstructionFilesBlock(
    payload: NormalizedVsCodeCodeAgentRuntimePayload,
  ): string {
    const lines: string[] = [];
    if (payload.workspaceLabel || payload.workspaceKey) {
      lines.push(
        `Workspace: ${payload.workspaceLabel || payload.workspaceKey || 'unknown'}`,
      );
    }
    if (payload.instructionIncludePatterns.length > 0) {
      lines.push(
        `Instruction patterns: ${payload.instructionIncludePatterns.join(', ')}`,
      );
    }

    if (payload.instructionFiles.length === 0) {
      lines.push('Aucun fichier d’instructions projet détecté.');
      return lines.join('\n');
    }

    lines.push('Fichiers d’instructions projet chargés:');
    for (const file of payload.instructionFiles) {
      lines.push(`--- ${file.path} ---`);
      lines.push(file.content);
    }

    return this.safeTruncate(
      lines.join('\n'),
      VSCODE_CODE_AGENT_INSTRUCTION_BLOCK_MAX_CHARS,
    );
  }

  private renderVsCodeBranchInfoBlock(
    payload: NormalizedVsCodeCodeAgentRuntimePayload,
  ): string {
    const workspace = payload.workspaceLabel || payload.workspaceKey || 'unknown';
    return `Workspace scope: ${workspace}`;
  }

  private renderVsCodeSystemContextBlock(
    payload: NormalizedVsCodeCodeAgentRuntimePayload,
  ): string {
    const context = payload.systemContext;
    const serverDateIso = new Date().toISOString();
    const serverTimezone = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
      } catch {
        return 'unknown';
      }
    })();
    const clientDateIso = context?.clientDateIso;
    const today = clientDateIso
      ? clientDateIso.slice(0, 10)
      : serverDateIso.slice(0, 10);
    const lines = [
      '<env>',
      `Working directory: ${
        context?.workingDirectory ||
        payload.workspaceKey ||
        payload.workspaceLabel ||
        'unknown'
      }`,
      `Is directory a git repo: ${
        context?.isGitRepo === true
          ? 'Yes'
          : context?.isGitRepo === false
            ? 'No'
            : 'Unknown'
      }`,
      ...(context?.gitBranch ? [`Git branch: ${context.gitBranch}`] : []),
      `Platform: ${context?.platform || 'unknown'}`,
      `OS Version: ${context?.osVersion || 'unknown'}`,
      ...(context?.shell ? [`Shell: ${context.shell}`] : []),
      `Today's date: ${today}`,
      ...(context?.clientTimezone ? [`Timezone: ${context.clientTimezone}`] : []),
      `Server date: ${serverDateIso}`,
      `Server timezone: ${serverTimezone}`,
      '</env>',
    ];
    return lines.join('\n');
  }

  private resolveVsCodeMonolithicPromptTemplate(
    payload: NormalizedVsCodeCodeAgentRuntimePayload,
  ): string {
    const defaultTemplate = this.getPromptTemplate('chat_code_agent');
    const resolvedTemplate =
      payload.promptWorkspaceOverride ??
      payload.promptGlobalOverride ??
      defaultTemplate;
    const normalized = resolvedTemplate.trim();
    if (!normalized) {
      throw new Error(
        'VSCode code-agent prompt is invalid: resolved prompt is empty. Open extension settings and provide a non-empty global/workspace prompt.',
      );
    }
    return normalized;
  }

  private extractAwaitingLocalToolState(
    events: Array<{
      eventType: string;
      data: unknown;
      sequence: number;
    }>
  ): AwaitingLocalToolState | null {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event.eventType !== 'status') continue;
      const data = asRecord(event.data);
      if (!data || data.state !== 'awaiting_local_tool_results') continue;

      const previousResponseId =
        typeof data.previous_response_id === 'string' ? data.previous_response_id : '';
      if (!previousResponseId) return null;

      const pendingLocalToolCalls: Array<{
        id: string;
        name: string;
        args: unknown;
      }> = [];
      const pendingRaw = Array.isArray(data.pending_local_tool_calls)
        ? data.pending_local_tool_calls
        : [];
      for (const item of pendingRaw) {
        const rec = asRecord(item);
        const toolCallId =
          rec && typeof rec.tool_call_id === 'string' ? rec.tool_call_id.trim() : '';
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        const args = rec ? rec.args : {};
        if (
          !toolCallId ||
          pendingLocalToolCalls.some((entry) => entry.id === toolCallId)
        ) {
          continue;
        }
        pendingLocalToolCalls.push({ id: toolCallId, name, args });
      }

      const baseToolOutputs: Array<{
        callId: string;
        output: string;
        name?: string;
        args?: unknown;
      }> = [];
      const outputsRaw = Array.isArray(data.base_tool_outputs)
        ? data.base_tool_outputs
        : [];
      for (const item of outputsRaw) {
        const rec = asRecord(item);
        const callId =
          rec && typeof rec.call_id === 'string' ? rec.call_id.trim() : '';
        const output =
          rec && typeof rec.output === 'string' ? rec.output : '';
        if (!callId) continue;
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        baseToolOutputs.push({
          callId,
          output,
          ...(name ? { name } : {}),
          ...(rec && 'args' in rec ? { args: rec.args } : {}),
        });
      }

      const localToolDefinitions: LocalToolDefinitionInput[] = [];
      const localDefsRaw = Array.isArray(data.local_tool_definitions)
        ? data.local_tool_definitions
        : [];
      for (const item of localDefsRaw) {
        const rec = asRecord(item);
        const name =
          rec && typeof rec.name === 'string' ? rec.name.trim() : '';
        const description =
          rec && typeof rec.description === 'string'
            ? rec.description.trim()
            : '';
        const parameters =
          rec && asRecord(rec.parameters)
            ? (rec.parameters as Record<string, unknown>)
            : null;
        if (!name || !description || !parameters || !isValidToolName(name))
          continue;
        localToolDefinitions.push({ name, description, parameters });
      }

      if (pendingLocalToolCalls.length === 0) return null;

      return {
        sequence: event.sequence,
        previousResponseId,
        pendingLocalToolCalls,
        baseToolOutputs,
        localToolDefinitions,
        vscodeCodeAgent: this.normalizeVsCodeCodeAgentPayload(
          data.vscode_code_agent as VsCodeCodeAgentRuntimePayload,
        ),
      };
    }

    return null;
  }

  async acceptLocalToolResult(options: {
    assistantMessageId: string;
    toolCallId: string;
    result: unknown;
  }): Promise<{
    readyToResume: boolean;
    waitingForToolCallIds: string[];
    localToolDefinitions: LocalToolDefinitionInput[];
    vscodeCodeAgent?: NormalizedVsCodeCodeAgentRuntimePayload | null;
    resumeFrom?: ChatResumeFromToolOutputs;
  }> {
    const toolCallId = String(options.toolCallId ?? '').trim();
    if (!toolCallId) {
      throw new Error('toolCallId is required');
    }

    const events = await readStreamEvents(options.assistantMessageId);
    const awaitingState = this.extractAwaitingLocalToolState(events);
    if (!awaitingState) {
      throw new Error('No pending local tool call found for this assistant message');
    }
    if (!awaitingState.pendingLocalToolCalls.some((entry) => entry.id === toolCallId)) {
      throw new Error(`Tool call ${toolCallId} is not pending for this assistant message`);
    }

    const rawResult = options.result;
    const resultObj = asRecord(rawResult);
    const normalizedResult = resultObj
      ? {
          ...(typeof resultObj.status === 'string' ? {} : { status: 'completed' }),
          ...resultObj
        }
      : { status: 'completed', value: rawResult };

    let streamSeq = await getNextSequence(options.assistantMessageId);
    await writeStreamEvent(
      options.assistantMessageId,
      'tool_call_result',
      { tool_call_id: toolCallId, result: normalizedResult },
      streamSeq,
      options.assistantMessageId
    );
    streamSeq += 1;

    await writeStreamEvent(
      options.assistantMessageId,
      'status',
      { state: 'local_tool_result_received', tool_call_id: toolCallId },
      streamSeq,
      options.assistantMessageId
    );

    const followupEvents = await readStreamEvents(options.assistantMessageId, awaitingState.sequence);
    const pendingSet = new Set(awaitingState.pendingLocalToolCalls.map((entry) => entry.id));
    const collectedByToolCallId = new Map<string, string>();
    for (const event of followupEvents) {
      if (event.eventType !== 'tool_call_result') continue;
      const data = asRecord(event.data);
      if (!data) continue;
      const id =
        typeof data.tool_call_id === 'string' ? data.tool_call_id.trim() : '';
      if (!id || !pendingSet.has(id)) continue;
      const output = this.serializeToolOutput(data.result);
      collectedByToolCallId.set(id, output);
    }

    const waitingForToolCallIds = awaitingState.pendingLocalToolCalls
      .map((entry) => entry.id)
      .filter((id) => !collectedByToolCallId.has(id));
    if (waitingForToolCallIds.length > 0) {
      return {
        readyToResume: false,
        waitingForToolCallIds,
        localToolDefinitions: awaitingState.localToolDefinitions,
        vscodeCodeAgent: awaitingState.vscodeCodeAgent,
      };
    }

    const dedupedOutputs = new Map<string, string>();
    for (const item of awaitingState.baseToolOutputs) {
      if (!item.callId) continue;
      dedupedOutputs.set(item.callId, item.output);
    }
    for (const id of awaitingState.pendingLocalToolCalls.map((entry) => entry.id)) {
      const output = collectedByToolCallId.get(id);
      if (!output) continue;
      dedupedOutputs.set(id, output);
    }
    const pendingById = new Map(
      awaitingState.pendingLocalToolCalls.map((entry) => [entry.id, entry] as const)
    );
    const baseById = new Map(
      awaitingState.baseToolOutputs.map((entry) => [entry.callId, entry] as const)
    );
    const toolOutputs = Array.from(dedupedOutputs.entries()).map(([callId, output]) => {
      const pending = pendingById.get(callId);
      const base = baseById.get(callId);
      return {
        callId,
        output,
        ...(pending?.name ? { name: pending.name } : base?.name ? { name: base.name } : {}),
        ...(pending ? { args: pending.args } : base && 'args' in base ? { args: base.args } : {}),
      };
    });

    return {
      readyToResume: true,
      waitingForToolCallIds: [],
      localToolDefinitions: awaitingState.localToolDefinitions,
      vscodeCodeAgent: awaitingState.vscodeCodeAgent,
      resumeFrom: {
        previousResponseId: awaitingState.previousResponseId,
        toolOutputs
      }
    };
  }

  private getPromptTemplate(id: string): string {
    return defaultPrompts.find((p) => p.id === id)?.content || '';
  }

  private renderTemplate(template: string, vars: Record<string, string>): string {
    return Object.entries(vars).reduce((acc, [key, value]) => {
      const token = `{{${key}}}`;
      return acc.split(token).join(value ?? '');
    }, template);
  }

  private formatContextLabel(type: ChatContextType | null | undefined, id: string | null | undefined): string {
    const t = (type ?? '').trim();
    const v = (id ?? '').trim();
    if (!t || !v) return 'Aucun contexte';
    return `${t}:${v}`;
  }

  private async generateSessionTitle(opts: {
    primaryContextType?: ChatContextType | null;
    primaryContextId?: string | null;
    lastUserMessage: string;
  }): Promise<string | null> {
    const template = this.getPromptTemplate('chat_session_title');
    if (!template) return null;
    const prompt = this.renderTemplate(template, {
      primary_context_label: this.formatContextLabel(opts.primaryContextType, opts.primaryContextId),
      last_user_message: (opts.lastUserMessage || '').trim()
    });
    try {
      const res = await callOpenAI({
        model: 'gpt-4.1-nano',
        messages: [{ role: 'system', content: prompt }],
        maxOutputTokens: 32
      });
      const content = res.choices?.[0]?.message?.content ?? '';
      const cleaned = String(content).trim().replace(/^["'`]+|["'`]+$/g, '');
      if (!cleaned) return null;
      return cleaned.slice(0, 80);
    } catch {
      return null;
    }
  }

  private async notifyWorkspaceEvent(workspaceId: string, data: Record<string, unknown> = {}): Promise<void> {
    const escape = (payload: Record<string, unknown>) => JSON.stringify(payload).replace(/'/g, "''");
    const client = await pool.connect();
    try {
      const payload = { workspace_id: workspaceId, data };
      await client.query(`NOTIFY workspace_events, '${escape(payload)}'`);
    } finally {
      client.release();
    }
  }

  async getMessageForUser(messageId: string, userId: string) {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        sequence: chatMessages.sequence
      })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .where(and(eq(chatMessages.id, messageId), eq(chatSessions.userId, userId)));
    return row ?? null;
  }

  private async getDetailedMessageForUser(messageId: string, userId: string) {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        contexts: chatMessages.contexts,
        toolCalls: chatMessages.toolCalls,
        toolCallId: chatMessages.toolCallId,
        reasoning: chatMessages.reasoning,
        model: chatMessages.model,
        promptId: chatMessages.promptId,
        promptVersionId: chatMessages.promptVersionId,
        sequence: chatMessages.sequence,
        createdAt: chatMessages.createdAt,
        feedbackVote: chatMessageFeedback.vote,
      })
      .from(chatMessages)
      .innerJoin(chatSessions, eq(chatMessages.sessionId, chatSessions.id))
      .leftJoin(
        chatMessageFeedback,
        and(eq(chatMessageFeedback.messageId, chatMessages.id), eq(chatMessageFeedback.userId, userId))
      )
      .where(and(eq(chatMessages.id, messageId), eq(chatSessions.userId, userId)));
    return row ?? null;
  }

  async getSessionForUser(sessionId: string, userId: string) {
    const [row] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
    return row;
  }

  async createSession(input: CreateChatSessionInput): Promise<{ sessionId: string }> {
    const sessionId = createId();
    await db.insert(chatSessions).values({
      id: sessionId,
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      primaryContextType: input.primaryContextType ?? null,
      primaryContextId: input.primaryContextId ?? null,
      title: input.title ?? null,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    return { sessionId };
  }

  async listSessions(userId: string, workspaceId?: string | null) {
    const normalizedWorkspaceId =
      typeof workspaceId === 'string' && workspaceId.trim().length > 0
        ? workspaceId.trim()
        : null;
    return await db
      .select()
      .from(chatSessions)
      .where(
        normalizedWorkspaceId
          ? and(
              eq(chatSessions.userId, userId),
              eq(chatSessions.workspaceId, normalizedWorkspaceId),
            )
          : eq(chatSessions.userId, userId),
      )
      .orderBy(desc(chatSessions.updatedAt), desc(chatSessions.createdAt));
  }

  async deleteSession(sessionId: string, userId: string): Promise<void> {
    const session = await this.getSessionForUser(sessionId, userId);
    if (!session) throw new Error('Session not found');
    await db.delete(chatSessions).where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));
  }

  async listMessages(sessionId: string, userId: string) {
    const session = await this.getSessionForUser(sessionId, userId);
    if (!session) throw new Error('Session not found');

    const messages = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        contexts: chatMessages.contexts,
        toolCalls: chatMessages.toolCalls,
        toolCallId: chatMessages.toolCallId,
        reasoning: chatMessages.reasoning,
        model: chatMessages.model,
        promptId: chatMessages.promptId,
        promptVersionId: chatMessages.promptVersionId,
        sequence: chatMessages.sequence,
        createdAt: chatMessages.createdAt,
        feedbackVote: chatMessageFeedback.vote
      })
      .from(chatMessages)
      .leftJoin(
        chatMessageFeedback,
        and(eq(chatMessageFeedback.messageId, chatMessages.id), eq(chatMessageFeedback.userId, userId))
      )
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence));

    let todoRuntime: Record<string, unknown> | null = null;
    const sessionWorkspaceId = await this.resolveSessionWorkspaceId(
      session,
      userId,
    );
    if (sessionWorkspaceId) {
      const role = (await getWorkspaceRole(userId, sessionWorkspaceId)) ?? 'viewer';
      todoRuntime = await todoOrchestrationService.getSessionTodoRuntime(
        { userId, role, workspaceId: sessionWorkspaceId },
        sessionId,
      );
    }

    return {
      messages,
      todoRuntime,
    };
  }

  private async resolveSessionWorkspaceId(
    session: { workspaceId?: string | null },
    userId: string,
  ): Promise<string | null> {
    if (
      typeof session.workspaceId === 'string' &&
      session.workspaceId.trim().length > 0
    ) {
      return session.workspaceId;
    }
    return (await ensureWorkspaceForUser(userId, { createIfMissing: false }))
      .workspaceId;
  }

  private async listSessionDocuments(options: {
    sessionId: string;
    workspaceId: string | null;
  }): Promise<ChatSessionDocumentItem[]> {
    if (!options.workspaceId) return [];

    const rows = await db
      .select()
      .from(contextDocuments)
      .where(
        and(
          eq(contextDocuments.workspaceId, options.workspaceId),
          eq(contextDocuments.contextType, 'chat_session'),
          eq(contextDocuments.contextId, options.sessionId),
        ),
      )
      .orderBy(desc(contextDocuments.createdAt));

    const jobIds = rows
      .map((row) => row.jobId)
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const jobById = new Map<string, { status: string | null }>();
    if (jobIds.length > 0) {
      const jobRows = await db
        .select({ id: jobQueue.id, status: jobQueue.status })
        .from(jobQueue)
        .where(
          and(
            eq(jobQueue.workspaceId, options.workspaceId),
            inArray(jobQueue.id, jobIds),
          ),
        );
      for (const job of jobRows) {
        jobById.set(job.id, { status: job.status ?? null });
      }
    }

    return rows.map((row) => ({
      status: (
        (row.status === 'uploaded' || row.status === 'processing') &&
        row.jobId &&
        jobById.get(row.jobId)?.status === 'failed'
          ? 'failed'
          : row.status
      ) as ChatSessionDocumentItem['status'],
      id: row.id,
      context_type: 'chat_session',
      context_id: row.contextId,
      filename: row.filename,
      mime_type: row.mimeType,
      size_bytes: row.sizeBytes,
      summary: getDataString(row.data, 'summary'),
      summary_lang: getDataString(row.data, 'summaryLang'),
      job_id: row.jobId,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }));
  }

  private async listAssistantDetailsByMessageId(
    messageIds: readonly string[],
  ): Promise<Record<string, ChatBootstrapStreamEvent[]>> {
    if (messageIds.length === 0) return {};

    const rows = await db
      .select({
        streamId: chatStreamEvents.streamId,
        eventType: chatStreamEvents.eventType,
        data: chatStreamEvents.data,
        sequence: chatStreamEvents.sequence,
        createdAt: chatStreamEvents.createdAt,
      })
      .from(chatStreamEvents)
      .where(inArray(chatStreamEvents.streamId, [...messageIds]))
      .orderBy(chatStreamEvents.streamId, chatStreamEvents.sequence);

    const out: Record<string, ChatBootstrapStreamEvent[]> = {};
    for (const row of rows) {
      const messageId = String(row.streamId ?? '').trim();
      if (!messageId) continue;
      if (!out[messageId]) out[messageId] = [];
      out[messageId].push({
        eventType: row.eventType,
        data: row.data,
        sequence: row.sequence,
        createdAt: row.createdAt,
      });
    }
    return out;
  }

  async getSessionBootstrap(options: { sessionId: string; userId: string }) {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.listCheckpoints({
        sessionId: options.sessionId,
        userId: options.userId,
        limit: 20,
      }),
      this.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.listAssistantDetailsByMessageId(assistantMessageIds);

    return {
      messages,
      todoRuntime,
      checkpoints,
      documents,
      assistantDetailsByMessageId,
    };
  }

  async getSessionHistory(options: {
    sessionId: string;
    userId: string;
    detailMode?: 'summary' | 'full';
  }): Promise<{
    sessionId: string;
    title: string | null;
    todoRuntime: Record<string, unknown> | null;
    checkpoints: ChatCheckpointSummary[];
    documents: ChatSessionDocumentItem[];
    items: ChatHistoryTimelineItem[];
  }> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const [{ messages, todoRuntime }, checkpoints, workspaceId] = await Promise.all([
      this.listMessages(options.sessionId, options.userId),
      this.listCheckpoints({
        sessionId: options.sessionId,
        userId: options.userId,
        limit: 20,
      }),
      this.resolveSessionWorkspaceId(session, options.userId),
    ]);

    const documents = await this.listSessionDocuments({
      sessionId: options.sessionId,
      workspaceId,
    });
    const assistantMessageIds = messages
      .filter((message) => message.role === 'assistant')
      .map((message) => String(message.id ?? '').trim())
      .filter((messageId) => messageId.length > 0);
    const assistantDetailsByMessageId =
      await this.listAssistantDetailsByMessageId(assistantMessageIds);
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    for (const [messageId, events] of Object.entries(assistantDetailsByMessageId)) {
      eventMap.set(messageId, events as ChatHistoryStreamEvent[]);
    }
    const projectedItems = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const items =
      options.detailMode === 'full'
        ? projectedItems
        : compactChatHistoryTimelineForSummary(projectedItems);

    return {
      sessionId: options.sessionId,
      title: session.title ?? null,
      todoRuntime,
      checkpoints,
      documents,
      items: [...items].reverse(),
    };
  }

  async getMessageRuntimeDetails(options: {
    messageId: string;
    userId: string;
  }): Promise<{
    messageId: string;
    items: ChatHistoryTimelineItem[];
  }> {
    const message = await this.getDetailedMessageForUser(
      options.messageId,
      options.userId,
    );
    if (!message) throw new Error('Message not found');
    if (message.role !== 'assistant') {
      throw new Error('Runtime details only exist for assistant messages');
    }

    const { messages } = await this.listMessages(
      message.sessionId,
      options.userId,
    );
    const details = await this.listAssistantDetailsByMessageId([options.messageId]);
    const events = (details[options.messageId] ?? []) as ChatHistoryStreamEvent[];
    const eventMap = new Map<string, ChatHistoryStreamEvent[]>();
    eventMap.set(options.messageId, events);
    const projected = buildChatHistoryTimeline(
      messages as ChatHistoryMessage[],
      eventMap,
    );
    const firstIndex = projected.findIndex(
      (item) => String(item.message.id ?? '').trim() === options.messageId,
    );
    const lastIndex = (() => {
      for (let index = projected.length - 1; index >= 0; index -= 1) {
        if (String(projected[index]?.message.id ?? '').trim() === options.messageId) {
          return index;
        }
      }
      return -1;
    })();
    const items =
      firstIndex >= 0 && lastIndex >= firstIndex
        ? projected.slice(firstIndex, lastIndex + 1)
        : buildAssistantMessageHistoryDetails(
            message as ChatHistoryMessage,
            events,
          );

    return {
      messageId: options.messageId,
      items,
    };
  }

  async createCheckpoint(options: {
    sessionId: string;
    userId: string;
    title?: string | null;
    anchorMessageId?: string | null;
  }): Promise<ChatCheckpointSummary> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const messages = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        contexts: chatMessages.contexts,
        toolCalls: chatMessages.toolCalls,
        toolCallId: chatMessages.toolCallId,
        reasoning: chatMessages.reasoning,
        model: chatMessages.model,
        promptId: chatMessages.promptId,
        promptVersionId: chatMessages.promptVersionId,
        sequence: chatMessages.sequence,
        createdAt: chatMessages.createdAt,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, options.sessionId))
      .orderBy(asc(chatMessages.sequence));

    if (messages.length === 0) {
      throw new Error('Cannot create checkpoint on an empty session');
    }

    const anchorMessage =
      (options.anchorMessageId
        ? messages.find((message) => message.id === options.anchorMessageId)
        : null) ?? messages[messages.length - 1];
    if (!anchorMessage) throw new Error('Anchor message not found');

    const anchorSequence = Number(anchorMessage.sequence ?? 0);
    if (!Number.isFinite(anchorSequence) || anchorSequence <= 0) {
      throw new Error('Invalid checkpoint anchor sequence');
    }

    const snapshotMessages = messages
      .filter((message) => Number(message.sequence ?? 0) <= anchorSequence)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        contexts: message.contexts,
        toolCalls: message.toolCalls,
        toolCallId: message.toolCallId,
        reasoning: message.reasoning,
        model: message.model,
        promptId: message.promptId,
        promptVersionId: message.promptVersionId,
        sequence: message.sequence,
        createdAt:
          message.createdAt instanceof Date
            ? message.createdAt.toISOString()
            : String(message.createdAt ?? ''),
      }));

    const checkpointId = createId();
    const now = new Date();
    const title =
      typeof options.title === 'string' && options.title.trim().length > 0
        ? options.title.trim()
        : `Checkpoint #${anchorSequence}`;

    const snapshot = {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      messages: snapshotMessages,
    };

    await db.insert(chatContexts).values({
      id: checkpointId,
      sessionId: options.sessionId,
      contextType: CHAT_CHECKPOINT_CONTEXT_TYPE,
      contextId: checkpointId,
      snapshotBefore: null,
      snapshotAfter: snapshot,
      modifications: {
        action: 'checkpoint_create',
        anchorMessageId: anchorMessage.id,
        anchorSequence,
      },
      modifiedAt: now,
      createdAt: now,
    });

    return {
      id: checkpointId,
      title,
      anchorMessageId: anchorMessage.id,
      anchorSequence,
      messageCount: snapshotMessages.length,
      createdAt: now.toISOString(),
    };
  }

  async listCheckpoints(options: {
    sessionId: string;
    userId: string;
    limit?: number;
  }): Promise<ChatCheckpointSummary[]> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const limit = Number.isFinite(options.limit)
      ? Math.min(Math.max(Math.floor(options.limit as number), 1), 100)
      : 20;

    const rows = await db
      .select({
        id: chatContexts.id,
        snapshotAfter: chatContexts.snapshotAfter,
        createdAt: chatContexts.createdAt,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.sessionId, options.sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      )
      .orderBy(desc(chatContexts.createdAt))
      .limit(limit);

    return rows.map((row) => {
      const snapshot = asRecord(row.snapshotAfter) ?? {};
      const titleRaw = String(snapshot.title ?? '').trim();
      const anchorMessageId = String(snapshot.anchorMessageId ?? '').trim();
      const anchorSequence = Number(snapshot.anchorSequence ?? 0);
      const messageCount = Number(snapshot.messageCount ?? 0);
      const createdAt =
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : new Date(String(row.createdAt ?? '')).toISOString();
      return {
        id: row.id,
        title: titleRaw || `Checkpoint #${anchorSequence || 0}`,
        anchorMessageId,
        anchorSequence: Number.isFinite(anchorSequence) ? anchorSequence : 0,
        messageCount: Number.isFinite(messageCount) ? messageCount : 0,
        createdAt,
      };
    });
  }

  async restoreCheckpoint(options: {
    sessionId: string;
    checkpointId: string;
    userId: string;
  }): Promise<{
    checkpointId: string;
    restoredToSequence: number;
    removedMessages: number;
  }> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const [checkpoint] = await db
      .select({
        id: chatContexts.id,
        snapshotAfter: chatContexts.snapshotAfter,
      })
      .from(chatContexts)
      .where(
        and(
          eq(chatContexts.id, options.checkpointId),
          eq(chatContexts.sessionId, options.sessionId),
          eq(chatContexts.contextType, CHAT_CHECKPOINT_CONTEXT_TYPE),
        ),
      );
    if (!checkpoint) throw new Error('Checkpoint not found');

    const snapshot = asRecord(checkpoint.snapshotAfter);
    const restoredToSequence = Number(snapshot?.anchorSequence ?? 0);
    if (!Number.isFinite(restoredToSequence) || restoredToSequence <= 0) {
      throw new Error('Invalid checkpoint payload');
    }

    const removedRows = await db
      .delete(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, options.sessionId),
          gt(chatMessages.sequence, restoredToSequence),
        ),
      )
      .returning({ id: chatMessages.id });

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, options.sessionId));

    return {
      checkpointId: checkpoint.id,
      restoredToSequence,
      removedMessages: removedRows.length,
    };
  }

  async setMessageFeedback(options: { messageId: string; userId: string; vote: 'up' | 'down' | 'clear' }) {
    const msg = await this.getMessageForUser(options.messageId, options.userId);
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'assistant') throw new Error('Feedback is only allowed on assistant messages');

    if (options.vote === 'clear') {
      await db
        .delete(chatMessageFeedback)
        .where(and(eq(chatMessageFeedback.messageId, options.messageId), eq(chatMessageFeedback.userId, options.userId)));
      return { vote: null };
    }

    const voteValue = options.vote === 'up' ? 1 : -1;
    const now = new Date();
    await db
      .insert(chatMessageFeedback)
      .values({
        id: createId(),
        messageId: options.messageId,
        userId: options.userId,
        vote: voteValue,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoUpdate({
        target: [chatMessageFeedback.messageId, chatMessageFeedback.userId],
        set: { vote: voteValue, updatedAt: now }
      });

    return { vote: voteValue };
  }

  async updateUserMessageContent(options: { messageId: string; userId: string; content: string }) {
    const msg = await this.getMessageForUser(options.messageId, options.userId);
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'user') throw new Error('Only user messages can be edited');

    await db
      .update(chatMessages)
      .set({ content: options.content })
      .where(eq(chatMessages.id, options.messageId));

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, msg.sessionId));

    return { messageId: options.messageId };
  }

  async retryUserMessage(options: {
    messageId: string;
    userId: string;
    providerId?: ProviderId | null;
    model?: string | null;
  }): Promise<{
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    streamId: string;
    providerId: ProviderId;
    model: string;
  }> {
    const msg = await this.getMessageForUser(options.messageId, options.userId);
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'user') throw new Error('Only user messages can be retried');

    const [aiSettings, catalog] = await Promise.all([
      settingsService.getAISettings({ userId: options.userId }),
      getModelCatalogPayload({ userId: options.userId }),
    ]);
    const inferredProviderId = inferProviderFromModelIdWithLegacy(
      catalog.models,
      options.model
    );
    const resolvedSelection = resolveDefaultSelection(
      {
        providerId:
          options.providerId || inferredProviderId || aiSettings.defaultProviderId,
        modelId: options.model || aiSettings.defaultModel,
      },
      catalog.models
    );
    const selectedModel = resolvedSelection.model_id;
    const selectedProviderId = resolvedSelection.provider_id;

    await db
      .delete(chatMessages)
      .where(and(eq(chatMessages.sessionId, msg.sessionId), gt(chatMessages.sequence, msg.sequence)));

    const assistantMessageId = createId();
    const assistantSeq = msg.sequence + 1;

    await db.insert(chatMessages).values({
      id: assistantMessageId,
      sessionId: msg.sessionId,
      role: 'assistant',
      content: null,
      toolCalls: null,
      toolCallId: null,
      reasoning: null,
      model: selectedModel,
      promptId: null,
      promptVersionId: null,
      sequence: assistantSeq,
      createdAt: new Date()
    });

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, msg.sessionId));

    return {
      sessionId: msg.sessionId,
      userMessageId: options.messageId,
      assistantMessageId,
      streamId: assistantMessageId,
      providerId: selectedProviderId,
      model: selectedModel
    };
  }

  private async getNextMessageSequence(sessionId: string): Promise<number> {
    const result = await db
      .select({ maxSequence: sql<number>`MAX(${chatMessages.sequence})` })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId));
    const maxSequence = result[0]?.maxSequence ?? 0;
    return maxSequence + 1;
  }

  /**
   * Crée le message user + le placeholder assistant (même session).
   * Le streamId pour le SSE chat est égal à l'id du message assistant.
   */
  async createUserMessageWithAssistantPlaceholder(input: CreateChatMessageInput): Promise<{
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    streamId: string;
    providerId: ProviderId;
    model: string;
  }> {
    const desiredWorkspaceId = input.workspaceId ?? null;
    const existing = input.sessionId ? await this.getSessionForUser(input.sessionId, input.userId) : null;
    const existingId = existing && typeof (existing as { id?: unknown }).id === 'string' ? (existing as { id: string }).id : null;
    const existingWorkspaceId =
      existing && typeof (existing as { workspaceId?: unknown }).workspaceId === 'string'
        ? ((existing as { workspaceId: string }).workspaceId as string)
        : null;
    const sessionId =
      existingId && existingWorkspaceId === desiredWorkspaceId
        ? existingId
        : (await this.createSession({
            userId: input.userId,
            workspaceId: desiredWorkspaceId,
            primaryContextType: input.primaryContextType ?? null,
            primaryContextId: input.primaryContextId ?? null,
            title: input.sessionTitle ?? null
          })).sessionId;
    const nextContextType = isChatContextType(input.primaryContextType) ? input.primaryContextType : null;
    const nextContextId = typeof input.primaryContextId === 'string' ? input.primaryContextId.trim() : '';

    if (nextContextType && nextContextId) {
      const shouldUpdateContext =
        !existing || existing.primaryContextType !== nextContextType || existing.primaryContextId !== nextContextId;
      if (shouldUpdateContext) {
        await db
          .update(chatSessions)
          .set({
            primaryContextType: nextContextType,
            primaryContextId: nextContextId,
            updatedAt: new Date()
          })
          .where(eq(chatSessions.id, sessionId));
      }
    }

    // Provider/model selection (request overrides > inferred by model id > workspace defaults).
    const [aiSettings, catalog] = await Promise.all([
      settingsService.getAISettings({ userId: input.userId }),
      getModelCatalogPayload({ userId: input.userId }),
    ]);
    const inferredProviderId = inferProviderFromModelIdWithLegacy(
      catalog.models,
      input.model
    );
    const resolvedSelection = resolveDefaultSelection(
      {
        providerId:
          input.providerId ||
          inferredProviderId ||
          aiSettings.defaultProviderId,
        modelId: input.model || aiSettings.defaultModel,
      },
      catalog.models
    );
    const selectedProviderId = resolvedSelection.provider_id;
    const selectedModel = resolvedSelection.model_id;
    const userSeq = await this.getNextMessageSequence(sessionId);
    const assistantSeq = userSeq + 1;

    const userMessageId = createId();
    const assistantMessageId = createId();

    const messageContexts = this.normalizeMessageContexts(input);

    await db.insert(chatMessages).values([
      {
        id: userMessageId,
        sessionId,
        role: 'user',
        content: input.content,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: null,
        promptId: null,
        promptVersionId: null,
        contexts: messageContexts.length > 0 ? messageContexts : null,
        sequence: userSeq,
        createdAt: new Date()
      },
      {
        id: assistantMessageId,
        sessionId,
        role: 'assistant',
        content: null,
        toolCalls: null,
        toolCallId: null,
        reasoning: null,
        model: selectedModel,
        promptId: null,
        promptVersionId: null,
        contexts: null,
        sequence: assistantSeq,
        createdAt: new Date()
      }
    ]);

    // Touch session updatedAt
    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    return {
      sessionId,
      userMessageId,
      assistantMessageId,
      streamId: assistantMessageId,
      providerId: selectedProviderId,
      model: selectedModel
    };
  }

  private async getAllowedDocumentsContexts(opts: {
    primaryContextType: ChatContextType | null | undefined;
    primaryContextId: string | null | undefined;
    workspaceId: string;
    sessionId: string;
    extraContexts?: Array<{ contextType: ChatContextType; contextId: string }>;
  }): Promise<Array<{ contextType: 'organization' | 'folder' | 'usecase' | 'chat_session'; contextId: string }>> {
    const out: Array<{ contextType: 'organization' | 'folder' | 'usecase' | 'chat_session'; contextId: string }> = [];
    const pushUnique = (contextType: 'organization' | 'folder' | 'usecase' | 'chat_session', contextId: string) => {
      if (!contextId) return;
      const key = `${contextType}:${contextId}`;
      if (out.some((c) => `${c.contextType}:${c.contextId}` === key)) return;
      out.push({ contextType, contextId });
    };
    if (opts.sessionId) {
      pushUnique('chat_session', opts.sessionId);
    }
    const appendContext = async (type: ChatContextType | null, idRaw: string | null | undefined) => {
      const id = (idRaw ?? '').trim();
      if (!type || !id) return;
      if (type === 'organization' || type === 'usecase') {
        pushUnique(type, id);
        return;
      }
      if (type === 'folder') {
        // Folder view can use folder docs + organization docs (if folder is linked to an org).
        pushUnique('folder', id);
        try {
          const [row] = await db
            .select({ organizationId: folders.organizationId })
            .from(folders)
            .where(and(eq(folders.id, id), eq(folders.workspaceId, opts.workspaceId)))
            .limit(1);
          const orgId = typeof row?.organizationId === 'string' ? row.organizationId : null;
          if (orgId) pushUnique('organization', orgId);
        } catch {
          // ignore (no org)
        }
        return;
      }
      if (type === 'executive_summary') {
        // Executive summary is a folder-scoped view.
        pushUnique('folder', id);
        // Also allow organization docs (folder.organizationId) to be used from this view.
        try {
          const [row] = await db
            .select({ organizationId: folders.organizationId })
            .from(folders)
            .where(and(eq(folders.id, id), eq(folders.workspaceId, opts.workspaceId)))
            .limit(1);
          const orgId = typeof row?.organizationId === 'string' ? row.organizationId : null;
          if (orgId) pushUnique('organization', orgId);
        } catch {
          // ignore (no org)
        }
      }
    };

    await appendContext(opts.primaryContextType ?? null, opts.primaryContextId);
    for (const ctx of opts.extraContexts ?? []) {
      await appendContext(ctx.contextType, ctx.contextId);
    }

    return out;
  }

  private async getAllowedCommentContexts(opts: {
    primaryContextType: ChatContextType | null | undefined;
    primaryContextId: string | null | undefined;
    workspaceId: string;
    extraContexts?: Array<{ contextType: ChatContextType; contextId: string }>;
  }): Promise<Array<{ contextType: CommentContextType; contextId: string }>> {
    const out: Array<{ contextType: CommentContextType; contextId: string }> = [];
    const pushUnique = (contextType: CommentContextType, contextId: string) => {
      if (!contextId) return;
      const key = `${contextType}:${contextId}`;
      if (out.some((c) => `${c.contextType}:${c.contextId}` === key)) return;
      out.push({ contextType, contextId });
    };

    const appendFolderUseCases = async (folderId: string) => {
      try {
        const res = await toolService.listUseCasesForFolder(folderId, {
          workspaceId: opts.workspaceId,
          idsOnly: true
        });
        if ('ids' in res) {
          for (const id of res.ids) pushUnique('usecase', id);
        }
      } catch {
        // ignore missing folder
      }
    };

    const appendContext = async (type: ChatContextType | null, idRaw: string | null | undefined) => {
      const id = (idRaw ?? '').trim();
      if (!type || !id) return;
      if (type === 'usecase') {
        pushUnique('usecase', id);
        return;
      }
      if (type === 'folder') {
        pushUnique('folder', id);
        await appendFolderUseCases(id);
        return;
      }
      if (type === 'executive_summary') {
        pushUnique('executive_summary', id);
        pushUnique('folder', id);
        await appendFolderUseCases(id);
        return;
      }
      if (type === 'organization') {
        pushUnique('organization', id);
        try {
          const res = await toolService.listFolders({
            workspaceId: opts.workspaceId,
            organizationId: id,
            idsOnly: true
          });
          if ('ids' in res) {
            for (const folderId of res.ids) {
              pushUnique('folder', folderId);
              await appendFolderUseCases(folderId);
            }
          }
        } catch {
          // ignore missing organization
        }
      }
    };

    await appendContext(opts.primaryContextType ?? null, opts.primaryContextId);
    for (const ctx of opts.extraContexts ?? []) {
      await appendContext(ctx.contextType, ctx.contextId);
    }

    return out;
  }

  /**
   * Exécute la génération assistant pour un message placeholder déjà créé.
   * Écrit les events dans chat_stream_events (streamId = assistantMessageId)
   * puis met à jour chat_messages.content + chat_messages.reasoning.
   */
  async runAssistantGeneration(options: {
    userId: string;
    sessionId: string;
    assistantMessageId: string;
    providerId?: ProviderId | null;
    providerApiKey?: string | null;
    model?: string | null;
    contexts?: Array<{ contextType: string; contextId: string }>;
    tools?: string[];
    localToolDefinitions?: LocalToolDefinitionInput[];
    vscodeCodeAgent?: VsCodeCodeAgentRuntimePayload | null;
    resumeFrom?: ChatResumeFromToolOutputs;
    locale?: string;
    signal?: AbortSignal;
  }): Promise<void> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const ownerWs = await ensureWorkspaceForUser(options.userId, { createIfMissing: false });
    const sessionWorkspaceId =
      session && typeof (session as { workspaceId?: unknown }).workspaceId === 'string'
        ? ((session as { workspaceId: string }).workspaceId as string)
        : ownerWs.workspaceId;
    if (!sessionWorkspaceId) throw new Error('Workspace not found for user');
    // Read-only mode:
    // - Hidden workspaces are read-only until unhidden (only /parametres should be used to unhide)
    // - Otherwise: writable if the user is editor/admin member of the session workspace
    const hidden = await isWorkspaceDeleted(sessionWorkspaceId);
    const canWrite = !hidden ? await hasWorkspaceRole(options.userId, sessionWorkspaceId, 'editor') : false;
    const readOnly = hidden || !canWrite;
    const currentUserRole = await getWorkspaceRole(options.userId, sessionWorkspaceId);

    const normalizeContexts = (items?: Array<{ contextType: string; contextId: string }>) => {
      const out: Array<{ contextType: ChatContextType; contextId: string }> = [];
      for (const item of items ?? []) {
        const type = item?.contextType;
        const id = (item?.contextId || '').trim();
        if (!isChatContextType(type) || !id) continue;
        const key = `${type}:${id}`;
        if (out.some((c) => `${c.contextType}:${c.contextId}` === key)) continue;
        out.push({ contextType: type, contextId: id });
      }
      return out;
    };
    const contextsOverride = normalizeContexts(options.contexts);
    const focusContext = contextsOverride[0] ?? null;

    // Charger messages (sans inclure le placeholder assistant)
    const messages = await db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, options.sessionId))
      .orderBy(asc(chatMessages.sequence));

    const assistantRow = messages.find((m) => m.id === options.assistantMessageId);
    if (!assistantRow) throw new Error('Assistant message not found');

    const conversation = messages
      .filter((m) => m.sequence < assistantRow.sequence)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content ?? ''
      }));
    const lastUserMessage =
      [...conversation].reverse().find((m) => m.role === 'user')?.content?.trim() || '';

    if (!session.title) {
      if (lastUserMessage.trim()) {
        const safeContextType =
          focusContext?.contextType || (isChatContextType(session.primaryContextType) ? session.primaryContextType : null);
        const title = await this.generateSessionTitle({
          primaryContextType: safeContextType,
          primaryContextId: session.primaryContextId ?? null,
          lastUserMessage
        });
        if (title) {
          await db
            .update(chatSessions)
            .set({ title, updatedAt: new Date() })
            .where(eq(chatSessions.id, session.id));
          await this.notifyWorkspaceEvent(sessionWorkspaceId, {
            action: 'chat_session_title_updated',
            sessionId: session.id,
            title
          });
        }
      }
    }

    // Récupérer le contexte depuis la session
    const primaryContextType = (focusContext?.contextType ??
      (isChatContextType(session.primaryContextType) ? session.primaryContextType : null)) as ChatContextType | null;
    const primaryContextId =
      focusContext?.contextId ?? (typeof session.primaryContextId === 'string' ? session.primaryContextId : null);

    const allowedContexts =
      contextsOverride.length > 0 && contextsOverride.every((c) => c.contextId)
        ? contextsOverride
        : primaryContextType && primaryContextId
          ? [{ contextType: primaryContextType, contextId: primaryContextId }]
          : [];
    const allowedByType = {
      organization: new Set<string>(),
      folder: new Set<string>(),
      usecase: new Set<string>(),
      executive_summary: new Set<string>()
    };
    for (const c of allowedContexts) {
      if (c.contextType === 'organization') allowedByType.organization.add(c.contextId);
      if (c.contextType === 'folder') allowedByType.folder.add(c.contextId);
      if (c.contextType === 'usecase') allowedByType.usecase.add(c.contextId);
      if (c.contextType === 'executive_summary') allowedByType.executive_summary.add(c.contextId);
    }
    const allowedFolderIds = new Set<string>([
      ...allowedByType.folder,
      ...allowedByType.executive_summary
    ]);
    const hasContextType = (type: ChatContextType) => {
      if (type === 'organization') return allowedByType.organization.size > 0;
      if (type === 'folder') return allowedFolderIds.size > 0;
      if (type === 'usecase') return allowedByType.usecase.size > 0;
      if (type === 'executive_summary') return allowedByType.executive_summary.size > 0;
      return false;
    };

    // Documents tool is only exposed if there are documents attached to the current context.
    const allowedDocContexts = await this.getAllowedDocumentsContexts({
      primaryContextType,
      primaryContextId,
      workspaceId: sessionWorkspaceId,
      sessionId: session.id,
      extraContexts: contextsOverride
    });

    const allowedCommentContexts = await this.getAllowedCommentContexts({
      primaryContextType,
      primaryContextId,
      workspaceId: sessionWorkspaceId,
      extraContexts: contextsOverride
    });
    const hasCommentContexts = allowedCommentContexts.length > 0;

    const hasDocuments = await (async () => {
      if (allowedDocContexts.length === 0) return false;
      try {
        for (const ctx of allowedDocContexts) {
          const rows = await db
            .select({ id: sql<string>`id` })
            .from(contextDocuments)
            .where(
              and(
                eq(contextDocuments.workspaceId, sessionWorkspaceId),
                eq(contextDocuments.contextType, ctx.contextType),
                eq(contextDocuments.contextId, ctx.contextId)
              )
            )
            .limit(1);
          if (rows.length > 0) return true;
        }
        return false;
      } catch {
        return false;
      }
    })();

    const requestedTools = new Set(Array.isArray(options.tools) ? options.tools : []);
    const todoToolRequested = requestedTools.has('plan');
    const sessionTodoRuntimeSnapshot = todoToolRequested
      ? toSessionTodoRuntimeSnapshot(
          await todoOrchestrationService.getSessionTodoRuntime(
            {
              userId: options.userId,
              role: currentUserRole ?? 'viewer',
              workspaceId: sessionWorkspaceId,
            },
            options.sessionId,
          ),
        )
      : null;
    const hasActiveSessionTodo = Boolean(
      sessionTodoRuntimeSnapshot &&
      !TODO_TERMINAL_STATUSES.has(sessionTodoRuntimeSnapshot.status),
    );
    const explicitTodoReplacementRequest =
      hasActiveSessionTodo && isExplicitTodoReplacementRequest(lastUserMessage);
    const enforceTodoUpdateMode =
      todoToolRequested && hasActiveSessionTodo && !explicitTodoReplacementRequest;
    const todoStructuralMutationIntent =
      enforceTodoUpdateMode && isExplicitTodoStructuralMutationRequest(lastUserMessage);
    const todoProgressionIntent =
      enforceTodoUpdateMode && isTodoProgressionIntent(lastUserMessage);
    const todoGoSignal = enforceTodoUpdateMode && isTodoGoSignal(lastUserMessage);
    const todoProgressionFocusMode = Boolean(todoProgressionIntent || todoGoSignal);

    // Prepare tools based on the active contexts (view-scoped behavior).
    // Note: destructive/batch tools are gated elsewhere; here we only enable what can be called.
    let tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
    const toolSet = new Map<string, OpenAI.Chat.Completions.ChatCompletionTool>();
    const addTools = (items: OpenAI.Chat.Completions.ChatCompletionTool[]) => {
      for (const t of items) {
        if (t.type !== 'function') continue;
        const name = t.function?.name;
        if (!name) continue;
        toolSet.set(name, t);
      }
    };
    const contextTypes = new Set<ChatContextType>();
    if (primaryContextType) contextTypes.add(primaryContextType);
    contextsOverride.forEach((c) => contextTypes.add(c.contextType));

    if (contextTypes.has('usecase')) {
      // Prefer Option B tool ids, but keep legacy ids for backward-compatibility.
      addTools([
        useCaseGetTool,
        readUseCaseTool,
        ...(readOnly ? [] : [useCaseUpdateTool, updateUseCaseFieldTool]),
        webSearchTool,
        webExtractTool
      ]);
    }
    if (contextTypes.has('organization')) {
      addTools([
        organizationsListTool,
        organizationGetTool,
        ...(readOnly ? [] : [organizationUpdateTool]),
        foldersListTool,
        webSearchTool,
        webExtractTool
      ]);
    }
    if (contextTypes.has('folder')) {
      addTools([
        foldersListTool,
        folderGetTool,
        ...(readOnly ? [] : [folderUpdateTool]),
        matrixGetTool,
        ...(readOnly ? [] : [matrixUpdateTool]),
        useCasesListTool,
        executiveSummaryGetTool,
        ...(readOnly ? [] : [executiveSummaryUpdateTool]),
        organizationGetTool,
        webSearchTool,
        webExtractTool
      ]);
    }
    if (contextTypes.has('executive_summary')) {
      addTools([
        executiveSummaryGetTool,
        ...(readOnly ? [] : [executiveSummaryUpdateTool]),
        useCasesListTool,
        folderGetTool,
        matrixGetTool,
        organizationGetTool,
        webSearchTool,
        webExtractTool
      ]);
    }
    const effectiveRequestedTools = new Set(requestedTools);
    if (todoToolRequested) {
      effectiveRequestedTools.add('plan');
    }
    if (enforceTodoUpdateMode) {
      effectiveRequestedTools.add('plan');
    }
    if (todoProgressionFocusMode) {
      effectiveRequestedTools.delete('web_search');
      effectiveRequestedTools.delete('web_extract');
    }
    if (effectiveRequestedTools.has('web_search')) {
      addTools([webSearchTool]);
    }
    if (effectiveRequestedTools.has('web_extract')) {
      addTools([webExtractTool]);
    }
    if (effectiveRequestedTools.has('plan') || enforceTodoUpdateMode) {
      addTools([planTool]);
    }
    if (hasDocuments) {
      addTools([documentsTool]);
    }
    if (hasCommentContexts) {
      addTools([commentAssistantTool]);
    }
    addTools([historyAnalyzeTool]);
    const localTools = this.normalizeLocalToolDefinitions(
      options.localToolDefinitions
    );
    addTools(localTools);
    tools = toolSet.size > 0 ? Array.from(toolSet.values()) : hasDocuments ? [documentsTool] : undefined;

    const localToolNames = new Set(
      localTools
        .map((t) =>
          t.type === 'function' && t.function?.name ? t.function.name : ''
        )
        .filter((name): name is string => Boolean(name))
    );

    if (Array.isArray(options.tools) && options.tools.length > 0 && tools?.length) {
      const allowed = new Set<string>([
        ...effectiveRequestedTools,
        'history_analyze',
        ...Array.from(localToolNames)
      ]);
      tools = tools.filter((t) => (t.type === 'function' ? allowed.has(t.function?.name || '') : false));
      if (tools.length === 0) tools = undefined;
    }

    const documentsToolName =
      documentsTool.type === 'function' ? documentsTool.function.name : 'documents';
    const hasDocumentsToolAvailable = Boolean(
      tools?.some(
        (t) => t.type === 'function' && t.function?.name === documentsToolName
      )
    );

    const contextLabel = (type: string, id: string) => {
      if (type === 'chat_session') return `Session de chat (${id})`;
      return `${type}:${id}`;
    };

    const documentsBlock = await (async () => {
      if (!hasDocumentsToolAvailable) {
        return [
          'DOCUMENTS DISPONIBLES :',
          '- Aucun document exploitable dans ce contexte.',
          '- Ne pas utiliser documents.list / documents.get_summary / documents.get_content / documents.analyze.'
        ].join('\n');
      }

      const contexts = allowedDocContexts;
      if (contexts.length === 0) {
        return 'DOCUMENTS DISPONIBLES :\n- Aucun document disponible pour les contextes autorisés.';
      }
      const conditions = contexts.map((c) =>
        and(eq(contextDocuments.contextType, c.contextType), eq(contextDocuments.contextId, c.contextId))
      );
      const rows = await db
        .select({
          contextType: contextDocuments.contextType,
          contextId: contextDocuments.contextId,
          id: contextDocuments.id
        })
        .from(contextDocuments)
        .where(and(eq(contextDocuments.workspaceId, sessionWorkspaceId), or(...conditions)));
      const counts = new Map<string, number>();
      for (const r of rows) {
        const key = `${r.contextType}:${r.contextId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const lines = contexts.map((c) => {
        const key = `${c.contextType}:${c.contextId}`;
        const count = counts.get(key) ?? 0;
        const status = count > 0 ? `${count} document(s)` : 'Aucun document';
        return `- ${contextLabel(c.contextType, c.contextId)} : ${status}`;
      });
      return [
        'DOCUMENTS DISPONIBLES :',
        ...lines,
        '',
        'Règles :',
        '- Toujours inclure les documents de session si présents.',
        '- Prioriser le contexte focus pour le listing.',
        '- Commencer par documents.list (le listing indique context_type/context_id).',
        '- Si un document est en cours de traitement, utiliser documents.analyze plutôt que get_summary.'
      ].join('\n');
    })();

    // Enrichir le system prompt avec le contexte si disponible
    let contextBlock = '';
    if (primaryContextType === 'usecase' && primaryContextId) {
      contextBlock = ` 

Tu travailles sur le use case ${primaryContextId}. Tu peux répondre aux questions générales de l'utilisateur en t'appuyant sur l'historique de la conversation.

Tools disponibles :
- \`usecase_get\` : Lit l'état actuel du use case
- \`usecase_update\` : Met à jour des champs du use case (modifications appliquées directement en DB)${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`web_search\` : Recherche d'informations récentes sur le web pour trouver de nouvelles URLs ou obtenir des résumés. Utilise ce tool quand tu dois chercher de nouvelles informations ou URLs pertinentes.
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs existantes. CRITIQUE : Utilise ce tool quand l'utilisateur demande des détails sur les références (URLs déjà présentes dans le use case). Si tu dois extraire plusieurs URLs (par exemple 9 URLs), tu DOIS toutes les passer dans UN SEUL appel avec le paramètre \`urls\` en array. NE FAIS JAMAIS plusieurs appels séparés (un par URL). Exemple : si tu as 9 URLs, appelle une seule fois avec \`{"urls": ["url1", "url2", ..., "url9"]}\` au lieu de faire 9 appels séparés.

Quand l'utilisateur demande explicitement de modifier, reformuler ou mettre à jour des champs du use case (par exemple : "reformuler le problème", "mettre en bullet points", "modifier la description"), tu DOIS utiliser les tools disponibles :
1. D'abord utiliser \`usecase_get\` pour lire l'état actuel du use case
2. Ensuite utiliser \`usecase_update\` pour appliquer directement les modifications demandées${readOnly ? ' (si disponible; sinon, propose une suggestion sans modifier en DB)' : ''}

Les modifications sont appliquées immédiatement en base de données via les tools. Ne réponds pas simplement dans le texte quand il s'agit de modifier le use case, utilise les tools pour effectuer les modifications réelles.

Si l'utilisateur demande une confirmation avant modification, propose alors les modifications dans le chat et attends sa validation avant d'utiliser les tools.

Tu peux utiliser \`web_search\` et \`web_extract\` pour enrichir les références du use case :
- \`web_search\` : Pour rechercher de nouvelles informations ou URLs pertinentes sur le web (tu obtiens des résumés et des URLs de résultats)
- \`web_extract\` : Pour extraire le contenu complet des URLs déjà présentes dans le use case.

**Workflow pour analyser les références** : Si l'utilisateur demande des détails sur les références (par exemple "regarde les références en détail", "résume les références"), tu DOIS :
1. D'abord appeler \`usecase_get\` pour lire le use case et obtenir les références dans \`data.references\` (qui est un array d'objets \`{title: string, url: string}\`)
2. Extraire toutes les URLs depuis \`data.references\` (chaque objet a une propriété \`url\`) et les mettre dans un array
3. Appeler \`web_extract\` UNE SEULE FOIS avec TOUTES les URLs dans le paramètre \`urls\`. Exemple concret : si \`data.references\` contient 9 objets avec des URLs, tu dois appeler \`web_extract\` une seule fois avec \`{"urls": ["https://url1.com", "https://url2.com", "https://url3.com", ..., "https://url9.com"]}\`. NE FAIS JAMAIS 9 appels séparés avec une URL chacun.
4. Utiliser le contenu extrait (qui sera dans \`result.results\`, un array d'objets \`{url: string, content: string}\`) pour répondre à la demande de l'utilisateur

Exemple concret : Si l'utilisateur dit "Je souhaite reformuler Problème et solution en bullet point", tu dois :
1. Appeler usecase_get pour lire le use case actuel
2. Appeler usecase_update avec les modifications (par exemple : path: 'problem', path: 'solution')
3. Les modifications sont alors appliquées directement en base de données`;
    } else if (primaryContextType === 'organization') {
      const orgLine = primaryContextId
        ? `Tu travailles sur l'organisation ${primaryContextId}.`
        : `Tu es sur la liste des organisations (pas d'organisation sélectionnée).`;
      contextBlock = ` 

${orgLine}

Tools disponibles :
- \`organizations_list\` : Liste des organisations (batch/list)
- \`organization_get\` : Lit le détail d'une organisation (utilise l'ID du contexte si présent)
- \`organization_update\` : Met à jour des champs d'une organisation${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`folders_list\` : Liste des dossiers (tu peux filtrer par organizationId)
- \`web_search\` : Recherche d'informations récentes sur le web
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs existantes (si plusieurs URLs, les passer en une seule fois via \`urls: []\`)

Règles :
- Pour lister les organisations visibles ici, utilise \`organizations_list\`.
- Si un contexte organizationId est présent, ne modifie/consulte que cette organisation.`;
    } else if (primaryContextType === 'folder') {
      const folderLine = primaryContextId
        ? `Tu travailles sur le dossier ${primaryContextId}.`
        : `Tu es sur la liste des dossiers (pas de dossier sélectionné). Tu peux lire les dossiers via \`folders_list\`, puis lire les cas d'usage d'un dossier via \`usecases_list\` en passant son folderId.`;
      contextBlock = ` 

${folderLine}

Tools disponibles :
- \`folder_get\` : Lit le dossier courant
- \`folder_update\` : Met à jour des champs du dossier courant${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`matrix_get\` : Lit la matrice (matrixConfig) du dossier
- \`matrix_update\` : Met à jour la matrice (matrixConfig) du dossier${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`usecases_list\` : Liste des cas d'usage du dossier courant (idsOnly ou select)
- \`executive_summary_get\` : Lit la synthèse exécutive du dossier courant
- \`executive_summary_update\` : Met à jour la synthèse exécutive du dossier courant${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`organization_get\` : Lit l'organisation rattachée au dossier (si le dossier a un organizationId)
- \`documents\` : Accède aux documents du **dossier** et/ou de **l'organisation liée** (liste / résumé / contenu borné / analyse) — uniquement si des documents sont présents
- \`web_search\` : Recherche d'informations récentes sur le web
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs existantes (si plusieurs URLs, les passer en une seule fois via \`urls: []\`)

Règles :
- Pour toute modification, lis d'abord puis mets à jour via les tools.
- Si un folderId de contexte est présent, ne lis/modifie que ce dossier. Sinon (vue liste), tu peux lire plusieurs dossiers en fournissant explicitement leur folderId.`;
    } else if (primaryContextType === 'executive_summary' && primaryContextId) {
      contextBlock = ` 

Tu travailles sur la synthèse exécutive du dossier ${primaryContextId}.

Tools disponibles :
- \`executive_summary_get\` : Lit la synthèse exécutive
- \`executive_summary_update\` : Met à jour la synthèse exécutive${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`usecases_list\` : Liste les cas d'usage du dossier (pour relier la synthèse aux cas)
- \`folder_get\` : Lit le dossier (contexte général)
- \`matrix_get\` : Lit la matrice (matrixConfig) du dossier
- \`organization_get\` : Lit l'organisation rattachée au dossier (si le dossier a un organizationId)
- \`documents\` : Accède aux documents du **dossier** et/ou de **l'organisation liée** (liste / résumé / contenu borné / analyse) — uniquement si des documents sont présents
- \`web_search\` : Recherche d'informations récentes sur le web
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs existantes (si plusieurs URLs, les passer en une seule fois via \`urls: []\`)

Règles :
- Ne tente pas d'accéder à un autre dossier que celui du contexte.`;
    }

    const historyContexts = contextsOverride.filter(
      (c) => !(c.contextType === primaryContextType && c.contextId === primaryContextId)
    );
    if (historyContexts.length > 0) {
      const historyLines = historyContexts.map((c) => `- ${c.contextType}:${c.contextId}`).join('\n');
      contextBlock += `\n\nContexte(s) historique(s) :\n${historyLines}\n\nRègle : prioriser le contexte focus, utiliser l’historique seulement si nécessaire.`;
    }

    if (hasCommentContexts) {
      contextBlock += `\n\nComment resolution tool:\n- \`comment_assistant\` (mode=suggest) to analyze comment threads and propose actions.\n- Always present the proposal as French markdown with a clear confirmation question.\n- Require an explicit user confirmation ("Confirmer" or "Annuler").\n- Only after confirmation, call \`comment_assistant\` with mode=resolve, include the same actions, and pass confirmation="yes".\n- If the user response is not an explicit confirmation, ask again with the fixed options.`;
    }
    if (todoToolRequested) {
      const todoLines: string[] = ['Plan runtime session constraints:'];
      if (sessionTodoRuntimeSnapshot) {
        todoLines.push(`- Active TODO id: ${sessionTodoRuntimeSnapshot.todoId}`);
        todoLines.push(`- Active TODO status: ${sessionTodoRuntimeSnapshot.status}`);
        if (sessionTodoRuntimeSnapshot.todoTitle) {
          todoLines.push(`- Active TODO title: ${sessionTodoRuntimeSnapshot.todoTitle}`);
        }
        if (sessionTodoRuntimeSnapshot.tasks.length > 0) {
          todoLines.push('- Ordered tasks (deterministic progression order):');
          for (const [index, task] of sessionTodoRuntimeSnapshot.tasks.slice(0, 20).entries()) {
            const taskId = task.id || '(no-id)';
            todoLines.push(`  ${index + 1}. taskId=${taskId} status=${task.status} title=${task.title}`);
          }
        } else {
          todoLines.push('- No tasks currently attached to this TODO.');
        }
      } else {
        todoLines.push('- No active session TODO found.');
      }
      todoLines.push('');
      todoLines.push('Mandatory plan orchestration rules:');
      if (enforceTodoUpdateMode) {
        todoLines.push(
          '- A session plan is already active: do NOT call `plan` with `action="create"` unless the user explicitly asks for a replacement/new list.',
        );
        todoLines.push(
          '- Prioritize progression of the active plan before starting unrelated planning.',
        );
        todoLines.push(
          '- Use `plan` with `action="update_task"` and `action="update_plan"` to progress the existing plan.',
        );
        todoLines.push(
          '- Progress task-by-task and persist each update while executing (no end-of-run bulk update only).',
        );
        todoLines.push(
          '- Ask blocker questions upfront in one batch, then continue autonomously until a real blocker appears.',
        );
        todoLines.push(
          '- Structural mutations (add/remove/reorder/replace tasks, or rewrite plan/task content) require explicit user intent.',
        );
      } else {
        todoLines.push(
          '- Use `plan` with `action="create"` only when the user explicitly asks to create a plan list.',
        );
      }
      if (explicitTodoReplacementRequest) {
        todoLines.push(
          '- The user explicitly asked for a replacement/new list: `plan` with `action="create"` is allowed.',
        );
      }
      if (todoStructuralMutationIntent) {
        todoLines.push(
          '- Explicit structural mutation intent detected: content/list changes are allowed in this turn.',
        );
      }
      if (todoProgressionFocusMode) {
        todoLines.push(
          '- Progression intent detected: execute the required TODO updates immediately in this answer (multiple tool calls if needed).',
        );
        todoLines.push(
          '- Deterministic progression: update tasks in listed order, continue until a real blocker (`blocked`, permission/guardrail error, or missing required input).',
        );
        if (todoGoSignal) {
          todoLines.push(
            '- User said "go": continue autonomously through next feasible tasks; ask one concise blocker question only if blocked.',
          );
        }
      }
      todoLines.push(
        '- When all tasks are terminal (`done`/`cancelled`), finalize the active plan with `plan` and `action="update_plan"` (`status: "done"` or `closed: true`).',
      );
      contextBlock += `\n\n${todoLines.join('\n')}`;
    }

    const activeToolNames = (tools ?? [])
      .map((tool) =>
        tool.type === 'function' && tool.function?.name
          ? tool.function.name
          : ''
      )
      .filter((name): name is string => Boolean(name));
    const activeToolsBlock =
      activeToolNames.length > 0
        ? `OUTILS ACTIFS POUR CETTE REPONSE :\n${activeToolNames.map((name) => `- \`${name}\``).join('\n')}\n\nRègle : si l'utilisateur demande les outils disponibles, répondre uniquement à partir de cette liste.`
        : `OUTILS ACTIFS POUR CETTE REPONSE :\n- Aucun outil actif.`;
    contextBlock += `\n\n${activeToolsBlock}`;

    const vscodeCodeAgentPayload = this.normalizeVsCodeCodeAgentPayload(
      options.vscodeCodeAgent,
    );
    const systemPrompt = (() => {
      if (vscodeCodeAgentPayload) {
        const template = this.resolveVsCodeMonolithicPromptTemplate(
          vscodeCodeAgentPayload,
        );
        const instructionFilesBlock =
          this.renderVsCodeInstructionFilesBlock(vscodeCodeAgentPayload);
        const branchInfoBlock =
          this.renderVsCodeBranchInfoBlock(vscodeCodeAgentPayload);
        const systemContextBlock =
          this.renderVsCodeSystemContextBlock(vscodeCodeAgentPayload);
        const hasInstructionPlaceholder = template.includes(
          '{{INSTRUCTION_FILES_BLOCK}}',
        );
        const hasBranchInfoPlaceholder = template.includes(
          '{{BRANCH_INFO_BLOCK}}',
        );
        const hasSystemContextPlaceholder = template.includes(
          '{{SYSTEM_CONTEXT_BLOCK}}',
        );
        const hasContextPlaceholder = template.includes('{{CONTEXT_BLOCK}}');
        let rendered = this.renderTemplate(template, {
          INSTRUCTION_FILES_BLOCK: instructionFilesBlock,
          BRANCH_INFO_BLOCK: branchInfoBlock,
          SYSTEM_CONTEXT_BLOCK: systemContextBlock,
          CONTEXT_BLOCK: contextBlock,
        }).trim();
        if (!hasInstructionPlaceholder && instructionFilesBlock.trim()) {
          rendered = `${rendered}\n\nContexte projet (fichiers d’instructions):\n${instructionFilesBlock}`.trim();
        }
        if (!hasBranchInfoPlaceholder && branchInfoBlock.trim()) {
          rendered = `${rendered}\n\nContexte de branche:\n${branchInfoBlock}`.trim();
        }
        if (!hasSystemContextPlaceholder && systemContextBlock.trim()) {
          rendered = `${rendered}\n\nSystem context:\n${systemContextBlock}`.trim();
        }
        if (!hasContextPlaceholder && contextBlock.trim()) {
          rendered = `${rendered}\n\nContexte runtime:\n${contextBlock}`.trim();
        }
        if (!rendered) {
          throw new Error(
            'VSCode code-agent prompt is invalid: rendered prompt is empty. Update extension settings (global/workspace prompt).',
          );
        }
        return rendered;
      }

      const basePrompt =
        this.getPromptTemplate('chat_system_base') ||
        "Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.\n\n{{CONTEXT_BLOCK}}\n\n{{DOCUMENTS_BLOCK}}\n\n{{AUTOMATION_BLOCK}}";
      const automationBlock = this.getPromptTemplate('chat_conversation_auto');
      return this.renderTemplate(basePrompt, {
        CONTEXT_BLOCK: contextBlock,
        DOCUMENTS_BLOCK: documentsBlock,
        AUTOMATION_BLOCK: automationBlock,
      }).trim();
    })();
    const STEER_PROMPT_MAX_MESSAGES = 8;
    const STEER_REASONING_REPLAY_MAX_CHARS = 6000;
    const STEER_REASONING_EXCERPT_MAX_CHARS = 1800;
    const normalizeSteerMessage = (value: string): string =>
      value
        .replace(/\s+/g, ' ')
        .trim();
    const normalizeReasoningExcerpt = (value: string): string => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return '';
      if (normalized.length <= STEER_REASONING_EXCERPT_MAX_CHARS) {
        return normalized;
      }
      return normalized.slice(-STEER_REASONING_EXCERPT_MAX_CHARS);
    };
    const buildSteerInterruptionPrompt = (
      messages: readonly string[],
      reasoningReplay: string,
    ): string => {
      if (messages.length === 0) return systemPrompt;
      const lastDirective = messages[messages.length - 1] ?? '';
      const lines = messages
        .slice(-STEER_PROMPT_MAX_MESSAGES)
        .map((message, index) => `${index + 1}. ${message}`);
      const reasoningExcerpt = normalizeReasoningExcerpt(reasoningReplay);
      const steerContext = [
        'SYSTEM NOTE - STEER INTERRUPTION',
        '- Previous reasoning was interrupted to integrate one or more user steering messages.',
        '- Consider every steering message listed below in chronological order.',
        '- If two steering directives conflict, the latest directive has priority.',
        '- Continue without re-asking for confirmation unless a blocker requires clarification.',
        '',
        'Steering messages:',
        ...lines,
        '',
        `Latest directive to prioritize: ${lastDirective}`,
      ].join('\n');
      if (!reasoningExcerpt) {
        return `${systemPrompt}\n\n${steerContext}`.trim();
      }
      return [
        systemPrompt,
        '',
        steerContext,
        '',
        'Reasoning excerpt already emitted before interruption (for continuity only):',
        reasoningExcerpt,
      ].join('\n').trim();
    };
    const isPreviousResponseNotFoundError = (message: string): boolean => {
      const normalized = message.toLowerCase();
      return (
        normalized.includes('previous response') &&
        normalized.includes('not found')
      );
    };
    const applySteerInterruptionPrompt = (
      messages: Array<
        | { role: 'system' | 'user' | 'assistant'; content: string }
        | { role: 'tool'; content: string; tool_call_id: string }
      >,
      steerMessages: readonly string[],
      reasoningReplay: string,
    ): Array<
      | { role: 'system' | 'user' | 'assistant'; content: string }
      | { role: 'tool'; content: string; tool_call_id: string }
    > => {
      const withoutSystem =
        messages.length > 0 && messages[0]?.role === 'system'
          ? messages.slice(1)
          : messages;
      return [
        {
          role: 'system' as const,
          content: buildSteerInterruptionPrompt(steerMessages, reasoningReplay),
        },
        ...withoutSystem,
      ];
    };

    let streamSeq = await getNextSequence(options.assistantMessageId);
    let lastObservedStreamSequence = Math.max(streamSeq - 1, 0);
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    let lastErrorMessage: string | null = null;
    const executedTools: Array<{ toolCallId: string; name: string; args: unknown; result: unknown }> = [];
    
    // État pour tracker les tool calls en cours
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    
    // Boucle itérative pour gérer plusieurs rounds de tool calls
    let currentMessages: ChatRuntimeMessage[] = [
      { role: 'system' as const, content: systemPrompt },
      ...conversation,
    ];
    let maxIterations = BASE_MAX_ITERATIONS;
    const todoAutonomousExtensionEnabled = Boolean(
      enforceTodoUpdateMode && todoProgressionFocusMode,
    );
    let todoContinuationActive = Boolean(
      todoAutonomousExtensionEnabled && hasActiveSessionTodo,
    );
    let todoAwaitingUserInput = false;
    let iteration = 0;
    let previousResponseId: string | null =
      options.resumeFrom?.previousResponseId ?? null;
    let pendingResponsesRawInput: unknown[] | null = Array.isArray(
      options.resumeFrom?.toolOutputs
    )
      ? options.resumeFrom!.toolOutputs.map((item) => ({
          type: 'function_call_output',
          call_id: item.callId,
          output: item.output,
        }))
      : null;
    const steerHistoryMessages: string[] = [];
    let steerReasoningReplay = '';
    let lastBudgetAnnouncedPct = -1;
    let contextBudgetReplanAttempts = 0;

    const [aiSettings, catalog] = await Promise.all([
      settingsService.getAISettings({ userId: options.userId }),
      getModelCatalogPayload({ userId: options.userId }),
    ]);
    const inferredProviderId = inferProviderFromModelIdWithLegacy(
      catalog.models,
      options.model || assistantRow.model || null
    );
    const resolvedSelection = resolveDefaultSelection(
      {
        providerId:
          options.providerId ||
          inferredProviderId ||
          aiSettings.defaultProviderId,
        modelId: options.model || assistantRow.model || aiSettings.defaultModel,
      },
      catalog.models
    );
    const selectedProviderId = resolvedSelection.provider_id;
    const selectedModel = resolvedSelection.model_id;
    const useCodexTransport =
      selectedProviderId === 'openai' &&
      selectedModel === 'gpt-5.4' &&
      (await getOpenAITransportMode()) === 'codex';

    // Reasoning-effort evaluation (best effort):
    // - Runs for any model whose catalog entry has reasoningTier !== 'none'.
    // - Evaluator uses a cheap model from the same provider family when available,
    //   otherwise falls back to OpenAI gpt-4.1-nano.
    const shouldEvaluateReasoningEffort = modelSupportsReasoning(selectedModel);
    const evaluatorProviderId: ProviderId =
      selectedProviderId === 'gemini' ? 'gemini' : 'openai';
    const evaluatorModel =
      selectedProviderId === 'gemini'
        ? 'gemini-3.1-flash-lite'
        : 'gpt-4.1-nano';
    let reasoningEffortForThisMessage: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
    // Default fallback if evaluator fails: medium.
    let reasoningEffortLabel: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium';
    let reasoningEffortBy: string | undefined;
    if (shouldEvaluateReasoningEffort) {
      try {
        const evalTemplate = defaultPrompts.find((p) => p.id === 'chat_reasoning_effort_eval')?.content || '';
        if (evalTemplate) {
          const lastUserMessage =
            [...conversation].reverse().find((m) => m.role === 'user')?.content?.trim() || '';
          const excerpt = conversation
            .slice(-8)
            .map((m) => `${m.role.toUpperCase()}: ${(m.content || '').slice(0, 2000)}`)
            .join('\n\n')
            .trim();
          const evalPrompt = evalTemplate
            .replace('{{last_user_message}}', lastUserMessage || '(vide)')
            .replace('{{context_excerpt}}', excerpt || '(vide)');

          let out = '';
          for await (const ev of callOpenAIResponseStream({
            providerId: evaluatorProviderId,
            model: evaluatorModel,
            userId: options.userId,
            workspaceId: sessionWorkspaceId,
            messages: [{ role: 'user', content: evalPrompt }],
            // Ask for a single token (none|low|medium|high|xhigh).
            maxOutputTokens: 64,
            signal: options.signal
          })) {
            if (ev.type === 'content_delta') {
              const d = (ev.data ?? {}) as Record<string, unknown>;
              const delta = typeof d.delta === 'string' ? d.delta : '';
              if (delta) out += delta;
            } else if (ev.type === 'error') {
              const d = (ev.data ?? {}) as Record<string, unknown>;
              const reqId = typeof d.request_id === 'string' ? d.request_id : '';
              const msg =
                typeof d.message === 'string'
                  ? d.message
                  : 'Reasoning effort evaluation failed';
              throw new Error(reqId ? `${msg} (request_id=${reqId})` : msg);
            }
          }

          const token = out.trim().split(/\s+/g)[0]?.toLowerCase() || '';
          if (token === 'none' || token === 'low' || token === 'medium' || token === 'high' || token === 'xhigh') {
            reasoningEffortForThisMessage = token;
            reasoningEffortLabel = token;
            reasoningEffortBy = evaluatorModel;
          } else {
            const preview = out.trim().slice(0, 200);
            throw new Error(`Invalid effort token from ${evaluatorModel}: "${preview}"`);
          }
        }
      } catch (e) {
        // Best-effort only: do not block the chat if the classifier fails.
        // But trace the failure for debugging in the UI timeline.
        const msg = e instanceof Error ? e.message : String(e ?? 'unknown');
        const safeMsg = msg.slice(0, 500);
        // Also log to API logs for debugging (user requested).
        try {
          console.error('[chat] reasoning_effort_eval_failed', {
            assistantMessageId: options.assistantMessageId,
            sessionId: options.sessionId,
            model: selectedModel,
            evaluatorModel,
            error: safeMsg,
          });
        } catch {
          // ignore
        }
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          { state: 'reasoning_effort_eval_failed', message: safeMsg },
          streamSeq,
          options.assistantMessageId
        );
        streamSeq += 1;
      }
    }
    // Always emit a "selected" status so the UI can display what was used.
    if (!reasoningEffortBy) {
      reasoningEffortBy = shouldEvaluateReasoningEffort ? 'fallback' : 'non-gpt-5';
    }
    await writeStreamEvent(
      options.assistantMessageId,
      'status',
      { state: 'reasoning_effort_selected', effort: reasoningEffortLabel, by: reasoningEffortBy },
      streamSeq,
      options.assistantMessageId
    );
    streamSeq += 1;

    let continueGenerationLoop = true;
    const consumePendingSteerMessages = async (): Promise<string[]> => {
      const events = await readStreamEvents(
        options.assistantMessageId,
        lastObservedStreamSequence,
      );
      if (events.length === 0) return [];
      lastObservedStreamSequence = events[events.length - 1]?.sequence ?? lastObservedStreamSequence;

      const messages: string[] = [];
      for (const event of events) {
        if (event.eventType !== 'status') continue;
        const data = asRecord(event.data);
        if (!data || data.state !== 'steer_received') continue;
        const message =
          typeof data.message === 'string'
            ? normalizeSteerMessage(data.message)
            : '';
        if (message) messages.push(message);
      }
      return messages;
    };

    const writeContextBudgetStatus = async (
      phase: 'pre_model' | 'pre_tool',
      snapshot: ContextBudgetSnapshot,
      extras?: Record<string, unknown>,
    ) => {
      if (
        snapshot.occupancyPct === lastBudgetAnnouncedPct &&
        snapshot.zone === 'normal'
      ) {
        return;
      }
      await writeStreamEvent(
        options.assistantMessageId,
        'status',
        {
          state: 'context_budget_update',
          phase,
          occupancy_pct: snapshot.occupancyPct,
          estimated_tokens: snapshot.estimatedTokens,
          max_tokens: snapshot.maxTokens,
          zone: snapshot.zone,
          ...(extras ?? {}),
        },
        streamSeq,
        options.assistantMessageId,
      );
      streamSeq += 1;
      lastBudgetAnnouncedPct = snapshot.occupancyPct;
    };

    const compactContextIfNeeded = async (
      reason:
        | 'pre_model_hard_threshold'
        | 'pre_tool_hard_threshold',
      snapshot: ContextBudgetSnapshot,
    ): Promise<ContextBudgetSnapshot> => {
      await writeStreamEvent(
        options.assistantMessageId,
        'status',
        {
          state: 'context_compaction_started',
          reason,
          occupancy_pct_before: snapshot.occupancyPct,
        },
        streamSeq,
        options.assistantMessageId,
      );
      streamSeq += 1;
      try {
        const compacted = await compactConversationContext({
          messages: currentMessages,
          providerId: selectedProviderId,
          modelId: selectedModel,
          userId: options.userId,
          workspaceId: sessionWorkspaceId,
          signal: options.signal,
        });
        if (compacted.summary.trim().length > 0) {
          currentMessages = compacted.compactedMessages;
        }
        const afterSnapshot = estimateContextBudget({
          messages: currentMessages,
          tools,
          rawInput: pendingResponsesRawInput,
          providerId: selectedProviderId,
          modelId: selectedModel,
        });
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          {
            state: 'context_compaction_done',
            reason,
            occupancy_pct_before: snapshot.occupancyPct,
            occupancy_pct_after: afterSnapshot.occupancyPct,
            summarized_messages: compacted.summarizedCount,
          },
          streamSeq,
          options.assistantMessageId,
        );
        streamSeq += 1;
        await writeContextBudgetStatus('pre_model', afterSnapshot, {
          source: 'compaction',
        });
        return afterSnapshot;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          {
            state: 'context_compaction_failed',
            reason,
            message: message.slice(0, 300),
          },
          streamSeq,
          options.assistantMessageId,
        );
        streamSeq += 1;
        return snapshot;
      }
    };

    while (continueGenerationLoop) {
      if (iteration >= maxIterations) {
        const canExtendTodoAutonomousLoop =
          todoAutonomousExtensionEnabled &&
          todoContinuationActive &&
          !todoAwaitingUserInput &&
          maxIterations < TODO_AUTONOMOUS_MAX_ITERATIONS;
        if (!canExtendTodoAutonomousLoop) {
          continueGenerationLoop = false;
          break;
        }
        maxIterations = Math.min(
          maxIterations + TODO_AUTONOMOUS_EXTENSION_STEP,
          TODO_AUTONOMOUS_MAX_ITERATIONS,
        );
      }
      iteration++;
      toolCalls.length = 0; // Réinitialiser pour chaque round
      contentParts.length = 0; // Réinitialiser le contenu pour chaque round
      reasoningParts.length = 0; // Réinitialiser le reasoning pour chaque round
      const pass1ToolChoice: 'auto' | 'required' =
        todoAutonomousExtensionEnabled &&
        todoContinuationActive &&
        !todoAwaitingUserInput
          ? 'required'
          : 'auto';
      currentMessages = applySteerInterruptionPrompt(
        currentMessages,
        steerHistoryMessages,
        steerReasoningReplay,
      );
      let preModelBudget = estimateContextBudget({
        messages: currentMessages,
        tools,
        rawInput: pendingResponsesRawInput,
        providerId: selectedProviderId,
        modelId: selectedModel,
      });
      await writeContextBudgetStatus('pre_model', preModelBudget);
      if (preModelBudget.zone === 'hard') {
        preModelBudget = await compactContextIfNeeded(
          'pre_model_hard_threshold',
          preModelBudget,
        );
      }
      let steerInterruptionRequested = false;
      let steerInterruptionBatch: string[] = [];

      // Trace: exact payload sent to OpenAI (per iteration)
      await writeChatGenerationTrace({
        enabled: env.CHAT_TRACE_ENABLED === 'true' || env.CHAT_TRACE_ENABLED === '1',
        sessionId: options.sessionId,
        assistantMessageId: options.assistantMessageId,
        userId: options.userId,
        workspaceId: sessionWorkspaceId,
        phase: 'pass1',
        iteration,
        model: selectedModel || null,
        toolChoice: pass1ToolChoice,
        // IMPORTANT: tracer les tools au complet (description + schema) pour debug.
        tools: tools ?? null,
        openaiMessages: {
          kind: 'responses_call',
          messages: currentMessages,
          previous_response_id: previousResponseId,
          raw_input: pendingResponsesRawInput
        },
        toolCalls: null,
        meta: {
          primaryContextType,
          primaryContextId,
          readOnly,
          maxIterations,
          callSite: 'ChatService.runAssistantGeneration/pass1/beforeOpenAI',
          openaiApi: 'responses'
        }
      });

      let shouldRetryWithoutPreviousResponse = false;
      try {
        for await (const event of callOpenAIResponseStream({
          providerId: selectedProviderId,
          model: selectedModel,
          credential: options.providerApiKey ?? undefined,
          userId: options.userId,
          workspaceId: sessionWorkspaceId,
          messages: currentMessages,
          tools,
          // on laisse le service openai gérer la compat modèle (gpt-4.1-nano n'a pas reasoning.summary)
          reasoningSummary: 'detailed',
          reasoningEffort: reasoningEffortForThisMessage,
          toolChoice: pass1ToolChoice,
          previousResponseId: previousResponseId ?? undefined,
          rawInput: pendingResponsesRawInput ?? undefined,
          signal: options.signal
        })) {
          const eventType = event.type as StreamEventType;
          const data = (event.data ?? {}) as Record<string, unknown>;
          // IMPORTANT: on n'émet pas 'done' ici. On émettra un unique 'done' à la toute fin,
          // après éventuel 2e pass (sinon l'UI peut se retrouver "terminée" sans contenu).
          if (eventType === 'done') {
            continue;
          }
          if (eventType === 'error') {
            const msg = (data as Record<string, unknown>).message;
            const errorMessage =
              typeof msg === 'string' ? msg : 'Unknown error';
            if (
              steerInterruptionRequested &&
              errorMessage.toLowerCase().includes('aborted')
            ) {
              continue;
            }
            lastErrorMessage = errorMessage;
            await writeStreamEvent(options.assistantMessageId, eventType, data, streamSeq, options.assistantMessageId);
            streamSeq += 1;
            // on laisse le flux se terminer / throw; le catch global gère
            continue;
          }

          await writeStreamEvent(options.assistantMessageId, eventType, data, streamSeq, options.assistantMessageId);
          streamSeq += 1;

          // Capture Responses API response_id for proper continuation
          if (eventType === 'status') {
            const responseId = typeof (data as Record<string, unknown>).response_id === 'string' ? ((data as Record<string, unknown>).response_id as string) : '';
            if (responseId) previousResponseId = responseId;
          }

          if (eventType === 'content_delta') {
            const delta = typeof data.delta === 'string' ? data.delta : '';
            if (delta) {
              contentParts.push(delta);
            }
          } else if (eventType === 'reasoning_delta') {
            const delta = typeof data.delta === 'string' ? data.delta : '';
            if (delta) {
              reasoningParts.push(delta);
              if (steerReasoningReplay.length < STEER_REASONING_REPLAY_MAX_CHARS) {
                steerReasoningReplay += delta;
                if (steerReasoningReplay.length > STEER_REASONING_REPLAY_MAX_CHARS) {
                  steerReasoningReplay = steerReasoningReplay.slice(
                    -STEER_REASONING_REPLAY_MAX_CHARS,
                  );
                }
              } else {
                steerReasoningReplay =
                  `${steerReasoningReplay}${delta}`.slice(
                    -STEER_REASONING_REPLAY_MAX_CHARS,
                  );
              }
            }
          } else if (eventType === 'tool_call_start') {
            const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
            const existingIndex = toolCalls.findIndex(tc => tc.id === toolCallId);
            if (existingIndex === -1) {
              toolCalls.push({
                id: toolCallId,
                name: typeof data.name === 'string' ? data.name : '',
                args: typeof data.args === 'string' ? data.args : ''
              });
            } else {
              const nextName = typeof data.name === 'string' ? data.name : '';
              const nextArgs = typeof data.args === 'string' ? data.args : '';
              toolCalls[existingIndex].name = nextName || toolCalls[existingIndex].name;
              toolCalls[existingIndex].args = (toolCalls[existingIndex].args || '') + (nextArgs || '');
            }
          } else if (eventType === 'tool_call_delta') {
            const toolCallId = typeof data.tool_call_id === 'string' ? data.tool_call_id : '';
            const delta = typeof data.delta === 'string' ? data.delta : '';
            const toolCall = toolCalls.find(tc => tc.id === toolCallId);
            if (toolCall) {
              toolCall.args += delta;
            } else {
              toolCalls.push({ id: toolCallId, name: '', args: delta });
            }
          }
          if (!steerInterruptionRequested) {
            const pendingSteerMessages = await consumePendingSteerMessages();
            if (pendingSteerMessages.length > 0) {
              steerInterruptionRequested = true;
              steerInterruptionBatch = pendingSteerMessages;
              await writeStreamEvent(
                options.assistantMessageId,
                'status',
                {
                  state: 'run_interrupted_for_steer',
                  steer_count: steerInterruptionBatch.length,
                  latest_message:
                    steerInterruptionBatch[steerInterruptionBatch.length - 1] ??
                    '',
                },
                streamSeq,
                options.assistantMessageId,
              );
              streamSeq += 1;
              break;
            }
          }
          // Note: eventType 'done' est volontairement retardé (voir plus haut)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? '');
        if (
          previousResponseId &&
          isPreviousResponseNotFoundError(message)
        ) {
          shouldRetryWithoutPreviousResponse = true;
        } else {
          throw error;
        }
      }
      if (shouldRetryWithoutPreviousResponse) {
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          {
            state: 'response_lineage_reset',
            reason: 'previous_response_not_found',
          },
          streamSeq,
          options.assistantMessageId,
        );
        streamSeq += 1;
        previousResponseId = null;
        pendingResponsesRawInput = null;
        continue;
      }
      if (steerInterruptionRequested && steerInterruptionBatch.length > 0) {
        pendingResponsesRawInput = null;
        previousResponseId = null;
        steerHistoryMessages.push(...steerInterruptionBatch);
        currentMessages = [
          ...currentMessages,
          ...steerInterruptionBatch.map((message) => ({
            role: 'user' as const,
            content: message,
          })),
        ];
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          {
            state: 'run_resumed_with_steer',
            steer_count: steerInterruptionBatch.length,
            latest_message:
              steerInterruptionBatch[steerInterruptionBatch.length - 1] ?? '',
          },
          streamSeq,
          options.assistantMessageId,
        );
        streamSeq += 1;
        continue;
      }

      // Debug (requested): if we asked for reasoningSummary=detailed but saw none, log it.
      if (modelSupportsReasoning(selectedModel) && reasoningParts.length === 0) {
        try {
          console.warn('[chat] no_reasoning_delta_observed', {
            assistantMessageId: options.assistantMessageId,
            sessionId: options.sessionId,
            model: selectedModel,
            phase: 'pass1',
            iteration,
            reasoningSummary: 'detailed',
            reasoningEffort: reasoningEffortForThisMessage ?? null,
            toolCalls: toolCalls.length,
          });
        } catch {
          // ignore
        }
      }
      // rawInput consommé pour ce tour (si présent)
      pendingResponsesRawInput = null;

      // Si aucun tool call, on termine
      if (toolCalls.length === 0) {
        continueGenerationLoop = false;
        break;
      }

      // Exécuter les tool calls et ajouter les résultats à la conversation
      const toolResults: Array<{ role: 'tool'; content: string; tool_call_id: string }> = [];
      const responseToolOutputs: Array<{
        type: 'function_call_output';
        call_id: string;
        output: string;
      }> = [];
      const pendingLocalToolCalls: Array<{
        id: string;
        name: string;
        args: unknown;
      }> = [];
      const orgByFolderId = new Map<string, string | null>();
      const getOrganizationIdForFolder = async (folderId: string): Promise<string | null> => {
        if (orgByFolderId.has(folderId)) return orgByFolderId.get(folderId) ?? null;
        try {
          const folder = await toolService.getFolder(folderId, {
            workspaceId: sessionWorkspaceId,
            select: ['organizationId']
          });
          const orgId = typeof (folder.data as Record<string, unknown>)?.organizationId === 'string'
            ? ((folder.data as Record<string, unknown>).organizationId as string)
            : null;
          orgByFolderId.set(folderId, orgId);
          return orgId;
        } catch {
          orgByFolderId.set(folderId, null);
          return null;
        }
      };
      const isAllowedOrganizationId = async (orgId: string): Promise<boolean> => {
        if (allowedByType.organization.has(orgId)) return true;
        for (const folderId of allowedFolderIds) {
          const folderOrgId = await getOrganizationIdForFolder(folderId);
          if (folderOrgId && folderOrgId === orgId) return true;
        }
        return false;
      };
      const allowedCommentContextSet = new Set(
        allowedCommentContexts.map((c) => `${c.contextType}:${c.contextId}`)
      );
      const lastUserMessage =
        [...conversation].reverse().find((m) => m.role === 'user')?.content?.trim() || '';
      const isExplicitConfirmation = (text: string, confirmationArg: unknown): boolean => {
        const normalized = (text || '').trim().toLowerCase();
        const arg = typeof confirmationArg === 'string' ? confirmationArg.trim().toLowerCase() : '';
        if (arg !== 'yes') return false;
        return ['oui', 'yes', 'confirmer', 'confirme', 'confirm', 'ok'].includes(normalized);
      };
      const markTodoIterationState = (rawResult: unknown) => {
        if (!todoAutonomousExtensionEnabled) return;
        const resultRecord = asRecord(rawResult) ?? {};
        const runtime = asRecord(resultRecord.todoRuntime) ?? resultRecord;
        const todoRecord = asRecord(runtime.todo);
        const activeTodoRecord = asRecord(runtime.activeTodo);
        const status = normalizeTodoRuntimeStatus(resultRecord.status ?? runtime.status);
        const todoStatus = normalizeTodoRuntimeStatus(
          runtime.todoStatus ??
            todoRecord?.derivedStatus ??
            activeTodoRecord?.derivedStatus,
        );
        const todoId = String(
          runtime.todoId ?? todoRecord?.id ?? activeTodoRecord?.id ?? '',
        ).trim();
        const message = String(
          resultRecord.error ?? runtime.error ?? resultRecord.message ?? runtime.message ?? '',
        ).toLowerCase();

        if (status === 'error') {
          todoAwaitingUserInput = true;
        }
        if (TODO_BLOCKING_STATUSES.has(todoStatus)) {
          todoAwaitingUserInput = true;
        }
        if (TODO_TERMINAL_STATUSES.has(todoStatus)) {
          todoContinuationActive = false;
        } else if (todoId.length > 0) {
          todoContinuationActive = true;
        }
        if (
          message.includes('requires explicit user intent') ||
          message.includes('is required') ||
          message.includes('missing') ||
          message.includes('security') ||
          message.includes('permission') ||
          message.includes('read-only') ||
          message.includes('confirm')
        ) {
          todoAwaitingUserInput = true;
        }
      };

      for (const toolCall of toolCalls) {
        if (options.signal?.aborted) throw new Error('AbortError');
        const toolName = String(toolCall.name || '').trim();
        if (toolName && localToolNames.has(toolName)) {
          pendingLocalToolCalls.push({
            id: toolCall.id,
            name: toolName,
            args: parseToolCallArgs(toolCall.args),
          });
          await writeStreamEvent(
            options.assistantMessageId,
            'tool_call_result',
            { tool_call_id: toolCall.id, result: { status: 'awaiting_external_result' } },
            streamSeq,
            options.assistantMessageId
          );
          streamSeq += 1;
          continue;
        }
        
        try {
          const args = JSON.parse(toolCall.args || '{}');
          const projectedResultChars = estimateToolResultProjectionChars(
            toolCall.name,
            asRecord(args) ?? {},
          );
          let preToolBudget = estimateContextBudget({
            messages: currentMessages,
            tools,
            rawInput: responseToolOutputs,
            providerId: selectedProviderId,
            modelId: selectedModel,
          });
          await writeContextBudgetStatus('pre_tool', preToolBudget, {
            tool_name: toolCall.name,
          });
          const computeProjected = (snapshot: ContextBudgetSnapshot) => {
            const projectedTokens =
              snapshot.estimatedTokens +
              estimateTokenCountFromChars(projectedResultChars);
            const projectedPct = Math.min(
              100,
              Math.max(0, Math.round((projectedTokens / snapshot.maxTokens) * 100)),
            );
            return {
              projectedTokens,
              projectedPct,
              projectedZone: resolveBudgetZone(projectedPct),
            };
          };
          let projectedBudget = computeProjected(preToolBudget);
          if (projectedBudget.projectedZone === 'hard') {
            preToolBudget = await compactContextIfNeeded(
              'pre_tool_hard_threshold',
              preToolBudget,
            );
            projectedBudget = computeProjected(preToolBudget);
          }
          if (projectedBudget.projectedZone !== 'normal') {
            contextBudgetReplanAttempts += 1;
            const escalationRequired =
              contextBudgetReplanAttempts > CONTEXT_BUDGET_MAX_REPLAN_ATTEMPTS;
            const deferredResult = {
              status: 'deferred',
              code:
                projectedBudget.projectedZone === 'hard'
                  ? CONTEXT_BUDGET_HARD_ZONE_CODE
                  : CONTEXT_BUDGET_SOFT_ZONE_CODE,
              message:
                projectedBudget.projectedZone === 'hard'
                  ? 'Tool call blocked: context budget still above hard threshold after compaction.'
                  : 'Tool call deferred: projected output would exceed context budget soft threshold.',
              occupancy_pct: projectedBudget.projectedPct,
              estimated_tokens: projectedBudget.projectedTokens,
              max_tokens: preToolBudget.maxTokens,
              replan_required: true,
              escalation_required: escalationRequired,
              suggested_actions: [
                'Narrow scope and retry tool with smaller payload.',
                'Use history_analyze for targeted extraction if needed.',
              ],
            };
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: deferredResult },
              streamSeq,
              options.assistantMessageId,
            );
            streamSeq += 1;
            if (escalationRequired) {
              await writeStreamEvent(
                options.assistantMessageId,
                'status',
                {
                  state: 'context_budget_user_escalation_required',
                  occupancy_pct: projectedBudget.projectedPct,
                  code: deferredResult.code,
                },
                streamSeq,
                options.assistantMessageId,
              );
              streamSeq += 1;
            }
            toolResults.push({
              role: 'tool',
              content: JSON.stringify(deferredResult),
              tool_call_id: toolCall.id,
            });
            responseToolOutputs.push({
              type: 'function_call_output',
              call_id: toolCall.id,
              output: JSON.stringify(deferredResult),
            });
            executedTools.push({
              toolCallId: toolCall.id,
              name: toolCall.name || 'unknown_tool',
              args,
              result: deferredResult,
            });
            continue;
          }
          contextBudgetReplanAttempts = 0;
          const todoOperation: TodoRuntimeToolOperation | null = (() => {
            if (toolCall.name !== 'plan') return null;
            const actionRaw =
              typeof args.action === 'string' ? args.action.trim().toLowerCase() : '';
            if (
              actionRaw === 'create' ||
              actionRaw === 'update_plan' ||
              actionRaw === 'update_task'
            ) {
              return actionRaw;
            }
            if (actionRaw.length > 0) {
              return null;
            }
            const hasTaskId =
              typeof args.taskId === 'string' && args.taskId.trim().length > 0;
            if (hasTaskId) return 'update_task';
            const hasTodoId =
              typeof args.todoId === 'string' && args.todoId.trim().length > 0;
            if (hasTodoId) return 'update_plan';
            return 'create';
          })();
          if (toolCall.name === 'plan' && !todoOperation) {
            throw new Error(
              'plan: action must be one of create|update_plan|update_task',
            );
          }
          let result: unknown;

          if (toolCall.name === 'read_usecase' || toolCall.name === 'usecase_get') {
            if (!allowedByType.usecase.has(args.useCaseId)) {
              throw new Error('Security: useCaseId does not match allowed contexts');
            }
            const readResult = await toolService.readUseCase(args.useCaseId, {
              workspaceId: sessionWorkspaceId,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = readResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              // Normaliser pour l'UI: toujours fournir result.status
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(readResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'update_usecase_field' || toolCall.name === 'usecase_update') {
            if (readOnly) {
              throw new Error('Read-only workspace: use case update is disabled');
            }
            if (!allowedByType.usecase.has(args.useCaseId)) {
              throw new Error('Security: useCaseId does not match allowed contexts');
            }
            const updateResult = await toolService.updateUseCaseFields({
              useCaseId: args.useCaseId,
              updates: args.updates || [],
              userId: options.userId,
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
              locale: options.locale,
              workspaceId: sessionWorkspaceId
            });
            result = updateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              // Normaliser pour l'UI: toujours fournir result.status
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(updateResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'organizations_list') {
            if (!hasContextType('organization')) {
              throw new Error('Security: organizations_list is only available in organization context');
            }
            const listResult = await toolService.listOrganizations({
              workspaceId: sessionWorkspaceId,
              idsOnly: !!args.idsOnly,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = listResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(listResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'organization_get') {
            if (!args.organizationId || typeof args.organizationId !== 'string') {
              throw new Error('Security: organizationId is required');
            }
            const allowed = await isAllowedOrganizationId(args.organizationId);
            if (!allowed) {
              throw new Error('Security: organizationId does not match allowed contexts');
            }

            const getResult = await toolService.getOrganization(args.organizationId, {
              workspaceId: sessionWorkspaceId,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = getResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(getResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'organization_update') {
            if (readOnly) throw new Error('Read-only workspace: organization_update is disabled');
            if (!args.organizationId || typeof args.organizationId !== 'string') {
              throw new Error('Security: organizationId is required');
            }
            const allowed = await isAllowedOrganizationId(args.organizationId);
            if (!allowed) {
              throw new Error('Security: organizationId does not match allowed contexts');
            }
            const updateResult = await toolService.updateOrganizationFields({
              organizationId: args.organizationId,
              updates: Array.isArray(args.updates) ? args.updates : [],
              userId: options.userId,
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
              locale: options.locale,
              workspaceId: sessionWorkspaceId
            });
            result = updateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(updateResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'folders_list') {
            if (!hasContextType('organization') && !hasContextType('folder')) {
              throw new Error('Security: folders_list is only available in organization/folder context');
            }
            const organizationId = typeof args.organizationId === 'string'
              ? args.organizationId
              : (allowedByType.organization.values().next().value ?? null);
            const listResult = await toolService.listFolders({
              workspaceId: sessionWorkspaceId,
              organizationId,
              idsOnly: !!args.idsOnly,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = listResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(listResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'folder_get') {
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const getResult = await toolService.getFolder(args.folderId, {
              workspaceId: sessionWorkspaceId,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = getResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(getResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'folder_update') {
            if (readOnly) throw new Error('Read-only workspace: folder_update is disabled');
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const updateResult = await toolService.updateFolderFields({
              folderId: args.folderId,
              updates: Array.isArray(args.updates) ? args.updates : [],
              userId: options.userId,
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
              locale: options.locale,
              workspaceId: sessionWorkspaceId
            });
            result = updateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(updateResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'usecases_list') {
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const listResult = await toolService.listUseCasesForFolder(args.folderId, {
              workspaceId: sessionWorkspaceId,
              idsOnly: !!args.idsOnly,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = listResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(listResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'executive_summary_get') {
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const getResult = await toolService.getExecutiveSummary(args.folderId, {
              workspaceId: sessionWorkspaceId,
              select: Array.isArray(args.select) ? args.select : null
            });
            result = getResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(getResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'executive_summary_update') {
            if (readOnly) throw new Error('Read-only workspace: executive_summary_update is disabled');
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const updateResult = await toolService.updateExecutiveSummaryFields({
              folderId: args.folderId,
              updates: Array.isArray(args.updates) ? args.updates : [],
              userId: options.userId,
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
              locale: options.locale,
              workspaceId: sessionWorkspaceId
            });
            result = updateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(updateResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'matrix_get') {
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const getResult = await toolService.getMatrix(args.folderId, { workspaceId: sessionWorkspaceId });
            result = getResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(getResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'matrix_update') {
            if (readOnly) throw new Error('Read-only workspace: matrix_update is disabled');
            if (!args.folderId || typeof args.folderId !== 'string') {
              throw new Error('Security: folderId is required');
            }
            if (!allowedFolderIds.has(args.folderId)) {
              throw new Error('Security: folderId does not match allowed contexts');
            }
            const updateResult = await toolService.updateMatrix({
              folderId: args.folderId,
              matrixConfig: args.matrixConfig,
              userId: options.userId,
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
              locale: options.locale,
              workspaceId: sessionWorkspaceId
            });
            result = updateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'completed', ...(updateResult as Record<string, unknown>) } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'plan' && todoOperation === 'create') {
            const createToolLabel = 'plan(action=create)';
            if (readOnly) {
              throw new Error(`Read-only workspace: ${createToolLabel} is disabled`);
            }
            const title = typeof args.title === 'string' ? args.title.trim() : '';
            if (!title) {
              throw new Error(`${createToolLabel}: title is required`);
            }
            const planId =
              typeof args.planId === 'string' && args.planId.trim().length > 0
                ? args.planId.trim()
                : undefined;
            const planTitle =
              typeof args.planTitle === 'string' && args.planTitle.trim().length > 0
                ? args.planTitle.trim()
                : undefined;
            const description =
              typeof args.description === 'string' && args.description.trim().length > 0
                ? args.description
                : undefined;
            const taskDrafts: unknown[] = Array.isArray(args.tasks)
              ? (args.tasks as unknown[])
              : [];
            const tasks: Array<{ title: string; description?: string }> =
              taskDrafts
              .map((item: unknown): { title: string; description?: string } => {
                const draft = asRecord(item);
                return {
                  title: typeof draft?.title === 'string' ? draft.title.trim() : '',
                  description:
                    typeof draft?.description === 'string'
                      ? draft.description
                      : undefined
                };
              })
              .filter((item) => item.title.length > 0);
            const metadata = asRecord(args.metadata) ?? undefined;

            const todoResult = await todoOrchestrationService.createTodoFromChat(
              {
                userId: options.userId,
                role: currentUserRole ?? 'editor',
                workspaceId: sessionWorkspaceId
              },
              {
                title,
                description,
                planId,
                planTitle,
                tasks,
                metadata,
                sessionId: options.sessionId
              }
            );
            const normalizedTodoResult = normalizeTodoRuntimeToolResult(
              'plan',
              toolCall.id,
              todoResult,
              'create',
            );
            markTodoIterationState(normalizedTodoResult);
            result = normalizedTodoResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: normalizedTodoResult },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'plan' && todoOperation === 'update_plan') {
            const todoUpdateLabel = 'plan(action=update_plan)';
            if (readOnly) {
              throw new Error(`Read-only workspace: ${todoUpdateLabel} is disabled`);
            }
            const todoId =
              typeof args.todoId === 'string' && args.todoId.trim().length > 0
                ? args.todoId.trim()
                : '';
            if (!todoId) {
              throw new Error(`${todoUpdateLabel}: todoId is required`);
            }
            const title =
              typeof args.title === 'string' && args.title.trim().length > 0
                ? args.title.trim()
                : undefined;
            const description =
              typeof args.description === 'string'
                ? args.description
                : undefined;
            const ownerUserId =
              typeof args.ownerUserId === 'string' && args.ownerUserId.trim().length > 0
                ? args.ownerUserId.trim()
                : undefined;
            const status =
              typeof args.status === 'string' && args.status.trim().length > 0
                ? args.status.trim()
                : undefined;
            const closed = typeof args.closed === 'boolean' ? args.closed : undefined;
            const metadataRecord = asRecord(args.metadata);
            const metadata =
              metadataRecord && Object.keys(metadataRecord).length > 0
                ? metadataRecord
                : undefined;
            const hasStructuralTodoMutationArgs =
              title !== undefined || description !== undefined || metadata !== undefined;
            if (
              enforceTodoUpdateMode &&
              hasStructuralTodoMutationArgs &&
              !todoStructuralMutationIntent
            ) {
              throw new Error(
                `${todoUpdateLabel}: structural mutation requires explicit user intent (add/remove/reorder/replace/edit list content)`,
              );
            }

            const updateResult = await todoOrchestrationService.updateTodoFromChat(
              {
                userId: options.userId,
                role: currentUserRole ?? 'editor',
                workspaceId: sessionWorkspaceId
              },
              {
                todoId,
                title,
                description,
                ownerUserId,
                status,
                closed,
                metadata
              }
            );
            const normalizedTodoUpdateResult = normalizeTodoRuntimeToolResult(
              'plan',
              toolCall.id,
              updateResult,
              'update_plan',
            );
            markTodoIterationState(normalizedTodoUpdateResult);
            result = normalizedTodoUpdateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: normalizedTodoUpdateResult },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'plan' && todoOperation === 'update_task') {
            const taskUpdateLabel = 'plan(action=update_task)';
            if (readOnly) {
              throw new Error(`Read-only workspace: ${taskUpdateLabel} is disabled`);
            }
            const taskId =
              typeof args.taskId === 'string' && args.taskId.trim().length > 0
                ? args.taskId.trim()
                : '';
            if (!taskId) {
              throw new Error(`${taskUpdateLabel}: taskId is required`);
            }
            const title =
              typeof args.title === 'string' && args.title.trim().length > 0
                ? args.title.trim()
                : undefined;
            const description =
              typeof args.description === 'string'
                ? args.description
                : undefined;
            const assigneeUserId =
              typeof args.assigneeUserId === 'string' && args.assigneeUserId.trim().length > 0
                ? args.assigneeUserId.trim()
                : undefined;
            const status =
              typeof args.status === 'string' && args.status.trim().length > 0
                ? args.status.trim()
                : undefined;
            const metadataRecord = asRecord(args.metadata);
            const metadata =
              metadataRecord && Object.keys(metadataRecord).length > 0
                ? metadataRecord
                : undefined;
            const hasStructuralTaskMutationArgs =
              title !== undefined || description !== undefined || metadata !== undefined;
            if (
              enforceTodoUpdateMode &&
              hasStructuralTaskMutationArgs &&
              !todoStructuralMutationIntent
            ) {
              throw new Error(
                `${taskUpdateLabel}: structural mutation requires explicit user intent (add/remove/reorder/replace/edit list content)`,
              );
            }

            const updateResult = await todoOrchestrationService.updateTaskFromChat(
              {
                userId: options.userId,
                role: currentUserRole ?? 'editor',
                workspaceId: sessionWorkspaceId
              },
              {
                taskId,
                title,
                description,
                assigneeUserId,
                status,
                metadata
              }
            );
            const normalizedTaskUpdateResult = normalizeTodoRuntimeToolResult(
              'plan',
              toolCall.id,
              updateResult,
              'update_task',
            );
            markTodoIterationState(normalizedTaskUpdateResult);
            result = normalizedTaskUpdateResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: normalizedTaskUpdateResult },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'comment_assistant') {
            const mode = typeof args.mode === 'string' ? args.mode : '';
            const contextType = typeof args.contextType === 'string' ? args.contextType : '';
            const contextId = typeof args.contextId === 'string' ? args.contextId.trim() : '';
            if (!isCommentContextType(contextType) || !contextId) {
              throw new Error('comment_assistant: contextType and contextId are required');
            }
            const allowedContext =
              allowedCommentContextSet.has(`${contextType}:${contextId}`) ||
              ((contextType === 'matrix' || contextType === 'executive_summary')
                && allowedCommentContextSet.has(`folder:${contextId}`));
            if (!allowedContext) {
              throw new Error('Security: comment context is not allowed');
            }
            const effectiveCommentContexts = allowedCommentContexts.some(
              (c) => c.contextType === contextType && c.contextId === contextId
            )
              ? allowedCommentContexts
              : [...allowedCommentContexts, { contextType, contextId }];

            if (mode === 'suggest') {
              const statusFilter = args.status === 'closed' ? 'closed' : 'open';
              const list = await toolService.listCommentThreadsForContexts({
                workspaceId: sessionWorkspaceId,
                contexts: effectiveCommentContexts,
                status: statusFilter,
                sectionKey: typeof args.sectionKey === 'string' ? args.sectionKey : null,
                threadId: typeof args.threadId === 'string' ? args.threadId : null,
                limit: 200
              });
              const proposal = await generateCommentResolutionProposal({
                threads: list.threads,
                users: list.users,
                contextLabel: `${contextType}:${contextId}`,
                currentUserId: options.userId,
                currentUserRole: currentUserRole ?? null,
                maxActions: 5
              });
              result = { status: 'completed', proposal, threads: list.threads };
            } else if (mode === 'resolve') {
              if (!isExplicitConfirmation(lastUserMessage, args.confirmation)) {
                throw new Error('Explicit user confirmation is required before resolving comments');
              }
              const actions = Array.isArray(args.actions) ? args.actions : [];
              const applied = await toolService.resolveCommentActions({
                workspaceId: sessionWorkspaceId,
                userId: options.userId,
                allowedContexts: effectiveCommentContexts,
                actions,
                toolCallId: toolCall.id
              });
              result = { status: 'completed', ...applied };
            } else {
              throw new Error(`comment_assistant: unknown mode ${mode}`);
            }

            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'web_search') {
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'executing' } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
            const searchResults = await searchWeb(args.query, options.signal);
            result = { status: 'completed', results: searchResults };
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'web_extract') {
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result: { status: 'executing' } },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
            const urls = Array.isArray(args.urls) ? args.urls : [args.url || args.urls].filter(Boolean);
            if (!urls || urls.length === 0) {
              throw new Error('web_extract: urls array must not be empty');
            }
            // IMPORTANT: Tavily extract supports arrays — do a single call for all URLs.
            const extractResult = await extractUrlContent(urls, options.signal);
            const resultsArray = Array.isArray(extractResult) ? extractResult : [extractResult];
            result = { status: 'completed', results: resultsArray };
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'documents') {
            // Security: documents tool must match the effective session context exactly.
            const allowed = allowedDocContexts;
            const isAllowed = allowed.some((c) => c.contextType === args.contextType && c.contextId === args.contextId);
            if (!isAllowed) {
              throw new Error('Security: context does not match session context');
            }

            const action = typeof args.action === 'string' ? args.action : '';
            if (action === 'list') {
              const list = await toolService.listContextDocuments({
                workspaceId: sessionWorkspaceId,
                contextType: args.contextType,
                contextId: args.contextId,
              });
              result = { status: 'completed', ...list };
            } else if (action === 'get_summary') {
              const documentId = typeof args.documentId === 'string' ? args.documentId : '';
              if (!documentId) throw new Error('documents.get_summary: documentId is required');
              const summary = await toolService.getDocumentSummary({
                workspaceId: sessionWorkspaceId,
                contextType: args.contextType,
                contextId: args.contextId,
                documentId,
              });
              result = { status: 'completed', ...summary };
            } else if (action === 'get_content') {
              const documentId = typeof args.documentId === 'string' ? args.documentId : '';
              if (!documentId) throw new Error('documents.get_content: documentId is required');
              const maxChars = typeof args.maxChars === 'number' ? args.maxChars : undefined;
              const content = await toolService.getDocumentContent({
                workspaceId: sessionWorkspaceId,
                contextType: args.contextType,
                contextId: args.contextId,
                documentId,
                maxChars,
              });
              result = { status: 'completed', ...content };
            } else if (action === 'analyze') {
              await writeStreamEvent(
                options.assistantMessageId,
                'tool_call_result',
                { tool_call_id: toolCall.id, result: { status: 'executing' } },
                streamSeq,
                options.assistantMessageId
              );
              streamSeq += 1;
              const documentId = typeof args.documentId === 'string' ? args.documentId : '';
              if (!documentId) throw new Error('documents.analyze: documentId is required');
              const prompt = typeof args.prompt === 'string' ? args.prompt : '';
              if (!prompt.trim()) throw new Error('documents.analyze: prompt is required');
              const maxWords = typeof args.maxWords === 'number' ? args.maxWords : undefined;
              const analysis = await toolService.analyzeDocument({
                workspaceId: sessionWorkspaceId,
                contextType: args.contextType,
                contextId: args.contextId,
                documentId,
                prompt,
                maxWords,
                signal: options.signal
              });
              result = { status: 'completed', ...analysis };
            } else {
              throw new Error(`documents: unknown action ${action}`);
            }

            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'history_analyze') {
            const question =
              typeof args.question === 'string' ? args.question.trim() : '';
            if (!question) {
              throw new Error('history_analyze: question is required');
            }
            const fromMessageId =
              typeof args.from_message_id === 'string'
                ? args.from_message_id
                : undefined;
            const toMessageId =
              typeof args.to_message_id === 'string'
                ? args.to_message_id
                : undefined;
            const maxTurns =
              typeof args.max_turns === 'number' ? args.max_turns : undefined;
            const targetToolCallId =
              typeof args.target_tool_call_id === 'string'
                ? args.target_tool_call_id
                : undefined;
            const targetToolResultMessageId =
              typeof args.target_tool_result_message_id === 'string'
                ? args.target_tool_result_message_id
                : undefined;
            const includeToolResults =
              typeof args.include_tool_results === 'boolean'
                ? args.include_tool_results
                : undefined;
            const includeSystemMessages =
              typeof args.include_system_messages === 'boolean'
                ? args.include_system_messages
                : undefined;
            const maxWords =
              typeof args.max_words === 'number' ? args.max_words : undefined;

            const analysis = await toolService.analyzeHistory({
              workspaceId: sessionWorkspaceId,
              sessionId: options.sessionId,
              question,
              fromMessageId,
              toMessageId,
              maxTurns,
              targetToolCallId,
              targetToolResultMessageId,
              includeToolResults,
              includeSystemMessages,
              maxWords,
              signal: options.signal,
            });
            result = { status: 'completed', ...analysis };
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else {
            throw new Error(`Unknown tool: ${toolCall.name}`);
          }

          // Garder une trace pour un éventuel 2e pass "rédaction-only"
          executedTools.push({ toolCallId: toolCall.id, name: toolCall.name, args, result });

          // Ajouter le résultat au format OpenAI pour continuer le stream
          toolResults.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id
          });

          // Responses API native continuation: function_call_output attached to call_id
          responseToolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.id,
            output: JSON.stringify(result),
          });
        } catch (error) {
          const errorResult = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
          const todoErrorCall = toolCall.name === 'plan';
          if (todoErrorCall && todoAutonomousExtensionEnabled) {
            markTodoIterationState(errorResult);
          }
          await writeStreamEvent(
            options.assistantMessageId,
            'tool_call_result',
            { tool_call_id: toolCall.id, result: errorResult },
            streamSeq,
            options.assistantMessageId
          );
          streamSeq += 1;
          toolResults.push({
            role: 'tool',
            content: JSON.stringify(errorResult),
            tool_call_id: toolCall.id
          });
          responseToolOutputs.push({
            type: 'function_call_output',
            call_id: toolCall.id,
            output: JSON.stringify(errorResult),
          });
          executedTools.push({
            toolCallId: toolCall.id,
            name: toolCall.name || 'unknown_tool',
            args: toolCall.args ? (() => { try { return JSON.parse(toolCall.args); } catch { return toolCall.args; } })() : undefined,
            result: errorResult
          });
        }
      }

      // Trace: executed tool calls for this iteration (args/results)
      await writeChatGenerationTrace({
        enabled: env.CHAT_TRACE_ENABLED === 'true' || env.CHAT_TRACE_ENABLED === '1',
        sessionId: options.sessionId,
        assistantMessageId: options.assistantMessageId,
        userId: options.userId,
        workspaceId: sessionWorkspaceId,
        phase: 'pass1',
        iteration,
        model: selectedModel || null,
        toolChoice: pass1ToolChoice,
        tools: tools ?? null,
        openaiMessages: {
          kind: 'executed_tools',
          messages: currentMessages,
          previous_response_id: previousResponseId,
          responses_input_tool_outputs: responseToolOutputs
        },
        toolCalls: toolCalls.map((tc) => {
          const found = executedTools.find((x) => x.toolCallId === tc.id);
          return {
            id: tc.id,
            name: tc.name,
            args: found?.args ?? (tc.args ? (() => { try { return JSON.parse(tc.args); } catch { return tc.args; } })() : undefined),
            result: found?.result
          };
        }),
        meta: { kind: 'executed_tools', callSite: 'ChatService.runAssistantGeneration/pass1/afterTools', openaiApi: 'responses' }
      });

      if (todoAutonomousExtensionEnabled && !todoAwaitingUserInput) {
        const refreshedSessionTodo = toSessionTodoRuntimeSnapshot(
          await todoOrchestrationService.getSessionTodoRuntime(
            {
              userId: options.userId,
              role: currentUserRole ?? 'viewer',
              workspaceId: sessionWorkspaceId,
            },
            options.sessionId,
          ),
        );
        if (!refreshedSessionTodo) {
          todoContinuationActive = false;
        } else {
          const refreshedStatus = normalizeTodoRuntimeStatus(
            refreshedSessionTodo.status,
          );
          todoContinuationActive = !TODO_TERMINAL_STATUSES.has(refreshedStatus);
          if (TODO_BLOCKING_STATUSES.has(refreshedStatus)) {
            todoAwaitingUserInput = true;
          }
        }
      }

      if (pendingLocalToolCalls.length > 0) {
        if (!previousResponseId) {
          throw new Error(
            'Unable to pause generation for local tools: missing previous_response_id'
          );
        }
        await writeStreamEvent(
          options.assistantMessageId,
          'status',
          {
            state: 'awaiting_local_tool_results',
            previous_response_id: previousResponseId,
            pending_local_tool_calls: pendingLocalToolCalls.map((item) => ({
              tool_call_id: item.id,
              name: item.name,
              args: item.args,
            })),
            local_tool_definitions: localTools.map((tool) => ({
              name: tool.type === 'function' ? tool.function.name : '',
              description:
                tool.type === 'function' ? tool.function.description ?? '' : '',
              parameters:
                tool.type === 'function'
                  ? ((tool.function.parameters ?? {}) as Record<string, unknown>)
                  : {}
            })),
            base_tool_outputs: responseToolOutputs.map((item) => ({
              call_id: item.call_id,
              output: item.output,
            })),
            vscode_code_agent: vscodeCodeAgentPayload
              ? {
                  source: 'vscode',
                  workspace_key: vscodeCodeAgentPayload.workspaceKey,
                  workspace_label: vscodeCodeAgentPayload.workspaceLabel,
                  prompt_global_override:
                    vscodeCodeAgentPayload.promptGlobalOverride,
                  prompt_workspace_override:
                    vscodeCodeAgentPayload.promptWorkspaceOverride,
                  instruction_include_patterns:
                    vscodeCodeAgentPayload.instructionIncludePatterns,
                  instruction_files: vscodeCodeAgentPayload.instructionFiles.map(
                    (file) => ({
                      path: file.path,
                      content: file.content,
                    }),
                  ),
                  system_context: vscodeCodeAgentPayload.systemContext
                    ? {
                        working_directory:
                          vscodeCodeAgentPayload.systemContext.workingDirectory,
                        is_git_repo:
                          vscodeCodeAgentPayload.systemContext.isGitRepo,
                        git_branch:
                          vscodeCodeAgentPayload.systemContext.gitBranch,
                        platform: vscodeCodeAgentPayload.systemContext.platform,
                        os_version: vscodeCodeAgentPayload.systemContext.osVersion,
                        shell: vscodeCodeAgentPayload.systemContext.shell,
                        client_date_iso:
                          vscodeCodeAgentPayload.systemContext.clientDateIso,
                        client_timezone:
                          vscodeCodeAgentPayload.systemContext.clientTimezone,
                      }
                    : undefined,
                }
              : undefined
          },
          streamSeq,
          options.assistantMessageId
        );
        streamSeq += 1;
        return;
      }

      // OPTION 1 (Responses API): on CONTINUE via previous_response_id + function_call_output
      // -> pas d'injection tool->user JSON, pas de "role:tool" dans messages.
      // On laisse `previousResponseId` alimenter l'appel suivant.
      // Pour l'historique local côté modèle, on n'ajoute l'assistant que si non vide.
      const assistantText = contentParts.join('');
      if (assistantText.trim()) {
        currentMessages = [...currentMessages, { role: 'assistant', content: assistantText }];
      }

      // Non-Responses-API providers (Claude, Mistral, Cohere, Codex) need both
      // function_call + function_call_output in rawInput so the runtime can
      // reconstruct the assistant tool_use / tool_calls block before tool results.
      const needsExplicitToolReplay =
        useCodexTransport ||
        selectedProviderId === 'anthropic' ||
        selectedProviderId === 'mistral' ||
        selectedProviderId === 'cohere';
      if (needsExplicitToolReplay) {
        if (useCodexTransport) previousResponseId = null;
        pendingResponsesRawInput = toolCalls.flatMap((toolCall) => {
          const output = responseToolOutputs.find((item) => item.call_id === toolCall.id);
          return output
            ? [
                {
                  type: 'function_call' as const,
                  call_id: toolCall.id,
                  name: toolCall.name,
                  arguments: toolCall.args || '{}',
                },
                output,
              ]
            : [];
        });
      } else {
        pendingResponsesRawInput = responseToolOutputs;
      }
    }

    // Si on arrive ici sans contenu final, on déclenche un 2e pass (sans tools) pour forcer une réponse.
    // Si le 2e pass échoue => on marque une erreur (et on laisse le job échouer).
    if (!contentParts.join('').trim()) {
      const lastUserMessage = [...conversation].reverse().find((m) => m.role === 'user')?.content ?? '';
      const digest = this.buildToolDigest(executedTools);
      const pass2System =
        systemPrompt +
        `\n\nIMPORTANT: Tu dois maintenant produire une réponse finale à l'utilisateur.\n` +
        `- Tu n'as pas le droit d'appeler d'outil (tools désactivés).\n` +
        `- Tu dois répondre en français, de manière concise et actionnable.\n` +
        `- Si une information manque, dis-le explicitement.\n`;

      const pass2Messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: pass2System },
        ...conversation,
        {
          role: 'user',
          content:
            `Demande utilisateur: ${lastUserMessage}\n\n` +
            `Résultats disponibles (outils déjà exécutés):\n${digest}\n\n` +
            `Rédige maintenant la réponse finale.`
        }
      ];

      // Réinitialiser buffers pour le contenu final
      contentParts.length = 0;
      reasoningParts.length = 0;
      lastErrorMessage = null;

      try {
        await writeChatGenerationTrace({
          enabled: env.CHAT_TRACE_ENABLED === 'true' || env.CHAT_TRACE_ENABLED === '1',
          sessionId: options.sessionId,
          assistantMessageId: options.assistantMessageId,
          userId: options.userId,
          workspaceId: sessionWorkspaceId,
          phase: 'pass2',
          iteration: 1,
          model: selectedModel || null,
          toolChoice: 'none',
          tools: null,
          openaiMessages: pass2Messages,
          toolCalls: null,
          meta: { kind: 'pass2_prompt', callSite: 'ChatService.runAssistantGeneration/pass2/beforeOpenAI', openaiApi: 'responses' }
        });

        for await (const event of callOpenAIResponseStream({
          providerId: selectedProviderId,
          model: selectedModel,
          credential: options.providerApiKey ?? undefined,
          userId: options.userId,
          workspaceId: sessionWorkspaceId,
          messages: pass2Messages,
          tools: undefined,
          toolChoice: 'none',
          reasoningSummary: 'detailed',
          reasoningEffort: reasoningEffortForThisMessage,
          signal: options.signal
        })) {
          const eventType = event.type as StreamEventType;
          const data = (event.data ?? {}) as Record<string, unknown>;
          if (eventType === 'done') {
            continue;
          }
          if (eventType === 'error') {
            const msg = (data as Record<string, unknown>).message;
            lastErrorMessage = typeof msg === 'string' ? msg : 'Unknown error';
            await writeStreamEvent(options.assistantMessageId, eventType, data, streamSeq, options.assistantMessageId);
            streamSeq += 1;
            continue;
          }
          // On stream les deltas pass2 sur le même streamId
          await writeStreamEvent(options.assistantMessageId, eventType, data, streamSeq, options.assistantMessageId);
          streamSeq += 1;
          if (eventType === 'content_delta') {
            const delta = typeof data.delta === 'string' ? data.delta : '';
            if (delta) {
              contentParts.push(delta);
            }
          } else if (eventType === 'reasoning_delta') {
            const delta = typeof data.delta === 'string' ? data.delta : '';
            if (delta) reasoningParts.push(delta);
          }
        }
      } catch (e) {
        const message =
          lastErrorMessage ||
          (e instanceof Error ? e.message : 'Second pass failed');
        // Marquer une erreur explicite côté stream
        await writeStreamEvent(
          options.assistantMessageId,
          'error',
          { message },
          streamSeq,
          options.assistantMessageId
        );
        streamSeq += 1;
        throw e;
      }

      if (!contentParts.join('').trim()) {
        const message = 'Second pass produced no content';
        await writeStreamEvent(options.assistantMessageId, 'error', { message }, streamSeq, options.assistantMessageId);
        streamSeq += 1;
        throw new Error(message);
      }
    }

    // Un seul terminal: done à la toute fin
    await writeStreamEvent(options.assistantMessageId, 'done', {}, streamSeq, options.assistantMessageId);
    streamSeq += 1;

    await db
      .update(chatMessages)
      .set({
        content: contentParts.join(''),
        reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : null,
        model: selectedModel || null
      })
      .where(eq(chatMessages.id, options.assistantMessageId));

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, options.sessionId));
  }

  /**
   * Finalise un message assistant à partir des events stream (ex: arrêt utilisateur).
   * - Recompose content/reasoning depuis les deltas.
   * - Émet un event terminal si manquant.
   */
  async finalizeAssistantMessageFromStream(options: {
    assistantMessageId: string;
    reason?: string;
    fallbackContent?: string;
  }): Promise<{
    content: string;
    reasoning: string | null;
    wroteDone: boolean;
  } | null> {
    const { assistantMessageId, reason, fallbackContent } = options;
    const [msg] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role,
        content: chatMessages.content,
        reasoning: chatMessages.reasoning
      })
      .from(chatMessages)
      .where(eq(chatMessages.id, assistantMessageId))
      .limit(1);

    if (!msg || msg.role !== 'assistant') return null;

    const events = await readStreamEvents(assistantMessageId);
    const hasTerminal = events.some((ev) => ev.eventType === 'done' || ev.eventType === 'error');

    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    for (const ev of events) {
      if (ev.eventType === 'content_delta') {
        const data = ev.data as { delta?: unknown } | null;
        const delta = typeof data?.delta === 'string' ? data.delta : '';
        if (delta) contentParts.push(delta);
      } else if (ev.eventType === 'reasoning_delta') {
        const data = ev.data as { delta?: unknown } | null;
        const delta = typeof data?.delta === 'string' ? data.delta : '';
        if (delta) reasoningParts.push(delta);
      }
    }

    let content = contentParts.join('');
    if (!content.trim() && fallbackContent) content = fallbackContent;

    const shouldUpdateContent = !msg.content || msg.content.trim().length === 0;
    if (shouldUpdateContent && content) {
      await db
        .update(chatMessages)
        .set({
          content,
          reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : null
        })
        .where(eq(chatMessages.id, assistantMessageId));
    }

    let wroteDone = false;
    if (!hasTerminal) {
      const seq = await getNextSequence(assistantMessageId);
      await writeStreamEvent(
        assistantMessageId,
        'done',
        { reason: reason ?? 'cancelled' },
        seq,
        assistantMessageId
      );
      wroteDone = true;
    }

    await db
      .update(chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(chatSessions.id, msg.sessionId));

    return {
      content,
      reasoning: reasoningParts.length > 0 ? reasoningParts.join('') : null,
      wroteDone
    };
  }
}

export const chatService = new ChatService();
