import { and, asc, desc, eq, sql, inArray, isNotNull, gt, or } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { chatMessageFeedback, chatMessages, chatSessions, chatStreamEvents, contextDocuments, folders } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAI, callOpenAIResponseStream, type StreamEventType } from './openai';
import { getNextSequence, readStreamEvents, writeStreamEvent } from './stream-service';
import { settingsService } from './settings';
import type OpenAI from 'openai';
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
  commentAssistantTool
} from './tools';
import { toolService } from './tool-service';
import { ensureWorkspaceForUser } from './workspace-service';
import { getWorkspaceRole, hasWorkspaceRole, isWorkspaceDeleted } from './workspace-access';
import { env } from '../config/env';
import { writeChatGenerationTrace } from './chat-trace';
import { generateCommentResolutionProposal } from './context-comments';

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

export type ChatResumeFromToolOutputs = {
  previousResponseId: string;
  toolOutputs: Array<{ callId: string; output: string }>;
};

type AwaitingLocalToolState = {
  sequence: number;
  previousResponseId: string;
  pendingToolCallIds: string[];
  baseToolOutputs: Array<{ callId: string; output: string }>;
  localToolDefinitions: LocalToolDefinitionInput[];
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const isValidToolName = (value: string): boolean => /^[a-zA-Z0-9_-]{1,64}$/.test(value);

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

      const pendingToolCallIds: string[] = [];
      const pendingRaw = Array.isArray(data.pending_local_tool_calls)
        ? data.pending_local_tool_calls
        : [];
      for (const item of pendingRaw) {
        const rec = asRecord(item);
        const toolCallId =
          rec && typeof rec.tool_call_id === 'string' ? rec.tool_call_id.trim() : '';
        if (!toolCallId || pendingToolCallIds.includes(toolCallId)) continue;
        pendingToolCallIds.push(toolCallId);
      }

      const baseToolOutputs: Array<{ callId: string; output: string }> = [];
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
        baseToolOutputs.push({ callId, output });
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

      if (pendingToolCallIds.length === 0) return null;

      return {
        sequence: event.sequence,
        previousResponseId,
        pendingToolCallIds,
        baseToolOutputs,
        localToolDefinitions
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
    if (!awaitingState.pendingToolCallIds.includes(toolCallId)) {
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
    const pendingSet = new Set(awaitingState.pendingToolCallIds);
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

    const waitingForToolCallIds = awaitingState.pendingToolCallIds.filter(
      (id) => !collectedByToolCallId.has(id)
    );
    if (waitingForToolCallIds.length > 0) {
      return {
        readyToResume: false,
        waitingForToolCallIds,
        localToolDefinitions: awaitingState.localToolDefinitions
      };
    }

    const dedupedOutputs = new Map<string, string>();
    for (const item of awaitingState.baseToolOutputs) {
      if (!item.callId) continue;
      dedupedOutputs.set(item.callId, item.output);
    }
    for (const id of awaitingState.pendingToolCallIds) {
      const output = collectedByToolCallId.get(id);
      if (!output) continue;
      dedupedOutputs.set(id, output);
    }
    const toolOutputs = Array.from(dedupedOutputs.entries()).map(([callId, output]) => ({
      callId,
      output
    }));

    return {
      readyToResume: true,
      waitingForToolCallIds: [],
      localToolDefinitions: awaitingState.localToolDefinitions,
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

  async listSessions(userId: string) {
    return await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
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

    return await db
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

  async retryUserMessage(options: { messageId: string; userId: string }): Promise<{
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    streamId: string;
    model: string;
  }> {
    const msg = await this.getMessageForUser(options.messageId, options.userId);
    if (!msg) throw new Error('Message not found');
    if (msg.role !== 'user') throw new Error('Only user messages can be retried');

    const aiSettings = await settingsService.getAISettings();
    const selectedModel = aiSettings.defaultModel;

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
      model: selectedModel
    };
  }

  async listStreamEventsForSession(options: {
    sessionId: string;
    userId: string;
    limitMessages?: number;
    limitEventsPerMessage?: number;
  }): Promise<Array<{ messageId: string; events: Array<{ eventType: string; data: unknown; sequence: number; createdAt: Date }> }>> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

    const limitMessages = Math.max(1, Math.min(50, options.limitMessages ?? 20));
    const limitEventsPerMessage = Math.max(10, Math.min(5000, options.limitEventsPerMessage ?? 2000));

    // Derniers messages assistant finalisés
    const assistantRows = await db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.sessionId, options.sessionId),
          eq(chatMessages.role, 'assistant'),
          isNotNull(chatMessages.content)
        )
      )
      .orderBy(desc(chatMessages.sequence))
      .limit(limitMessages);

    const messageIds = assistantRows.map((r) => r.id).filter(Boolean);
    if (messageIds.length === 0) return [];

    const rows = await db
      .select({
        streamId: chatStreamEvents.streamId,
        eventType: chatStreamEvents.eventType,
        data: chatStreamEvents.data,
        sequence: chatStreamEvents.sequence,
        createdAt: chatStreamEvents.createdAt
      })
      .from(chatStreamEvents)
      .where(inArray(chatStreamEvents.streamId, messageIds))
      .orderBy(chatStreamEvents.streamId, chatStreamEvents.sequence);

    const byId = new Map<string, Array<{ eventType: string; data: unknown; sequence: number; createdAt: Date }>>();
    for (const r of rows) {
      const sid = r.streamId;
      if (!sid) continue;
      const arr = byId.get(sid) ?? [];
      if (arr.length < limitEventsPerMessage) {
        arr.push({ eventType: r.eventType, data: r.data, sequence: r.sequence, createdAt: r.createdAt });
      }
      byId.set(sid, arr);
    }

    // Garder l'ordre "le plus récent d'abord" côté messages, mais les events restent triés
    return messageIds.map((id) => ({ messageId: id, events: byId.get(id) ?? [] }));
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

    // Modèle (default settings si non fourni)
    const aiSettings = await settingsService.getAISettings();
    const selectedModel = input.model || aiSettings.defaultModel;

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
    model?: string | null;
    contexts?: Array<{ contextType: string; contextId: string }>;
    tools?: string[];
    localToolDefinitions?: LocalToolDefinitionInput[];
    resumeFrom?: ChatResumeFromToolOutputs;
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

    if (!session.title) {
      const lastUserMessage =
        [...messages]
          .filter((m) => m.sequence < assistantRow.sequence && m.role === 'user')
          .pop()?.content ?? '';
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
    if (hasDocuments) {
      addTools([documentsTool]);
    }
    if (hasCommentContexts) {
      addTools([commentAssistantTool]);
    }
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
        ...options.tools,
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

    const basePrompt = this.getPromptTemplate('chat_system_base')
      || "Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.\n\n{{CONTEXT_BLOCK}}\n\n{{DOCUMENTS_BLOCK}}\n\n{{AUTOMATION_BLOCK}}";
    const automationBlock = this.getPromptTemplate('chat_conversation_auto');
    const systemPrompt = this.renderTemplate(basePrompt, {
      CONTEXT_BLOCK: contextBlock,
      DOCUMENTS_BLOCK: documentsBlock,
      AUTOMATION_BLOCK: automationBlock
    }).trim();

    let streamSeq = await getNextSequence(options.assistantMessageId);
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    let lastErrorMessage: string | null = null;
    const executedTools: Array<{ toolCallId: string; name: string; args: unknown; result: unknown }> = [];
    
    // État pour tracker les tool calls en cours
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    
    // Boucle itérative pour gérer plusieurs rounds de tool calls
    let currentMessages: Array<
      | { role: 'system' | 'user' | 'assistant'; content: string }
      | { role: 'tool'; content: string; tool_call_id: string }
    > = [{ role: 'system' as const, content: systemPrompt }, ...conversation];
    const maxIterations = 10; // Limite de sécurité pour éviter les boucles infinies
    let iteration = 0;
    let previousResponseId: string | null =
      options.resumeFrom?.previousResponseId ?? null;
    let pendingResponsesRawInput: unknown[] | null = Array.isArray(
      options.resumeFrom?.toolOutputs
    )
      ? options.resumeFrom!.toolOutputs.map((item) => ({
          type: 'function_call_output',
          call_id: item.callId,
          output: item.output
        }))
      : null;

    // If the selected model is gpt-5*, dynamically evaluate the reasoning effort needed for the last user question
    // using gpt-5-nano (cheap classifier). This value (low/medium/high) is then passed as `reasoning.effort`.
    const selectedModel = options.model || assistantRow.model || '';
    const isGpt5 = typeof selectedModel === 'string' && selectedModel.startsWith('gpt-5');
    let reasoningEffortForThisMessage: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | undefined;
    // Default fallback if evaluator fails: medium.
    let reasoningEffortLabel: 'none' | 'low' | 'medium' | 'high' | 'xhigh' = 'medium';
    let reasoningEffortBy: string | undefined;
    if (isGpt5) {
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

          // Evaluator model: prefer robustness over reasoning controls.
          // gpt-4.1-nano does not support reasoning params (we already skip them in openai.ts),
          // and avoids the server_error observed with gpt-5-nano effort=minimal.
          const evaluatorModel = 'gpt-4.1-nano';
          let out = '';
          for await (const ev of callOpenAIResponseStream({
            model: evaluatorModel,
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
              const msg = typeof d.message === 'string' ? d.message : 'Erreur OpenAI (effort eval)';
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
            evaluatorModel: 'gpt-4.1-nano',
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
    if (!reasoningEffortBy) reasoningEffortBy = isGpt5 ? 'fallback' : 'non-gpt-5';
    await writeStreamEvent(
      options.assistantMessageId,
      'status',
      { state: 'reasoning_effort_selected', effort: reasoningEffortLabel, by: reasoningEffortBy },
      streamSeq,
      options.assistantMessageId
    );
    streamSeq += 1;

    while (iteration < maxIterations) {
      iteration++;
      toolCalls.length = 0; // Réinitialiser pour chaque round
      contentParts.length = 0; // Réinitialiser le contenu pour chaque round
      reasoningParts.length = 0; // Réinitialiser le reasoning pour chaque round

      // Trace: exact payload sent to OpenAI (per iteration)
      await writeChatGenerationTrace({
        enabled: env.CHAT_TRACE_ENABLED === 'true' || env.CHAT_TRACE_ENABLED === '1',
        sessionId: options.sessionId,
        assistantMessageId: options.assistantMessageId,
        userId: options.userId,
        workspaceId: sessionWorkspaceId,
        phase: 'pass1',
        iteration,
        model: options.model || assistantRow.model || null,
        toolChoice: 'auto',
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

      for await (const event of callOpenAIResponseStream({
        model: options.model || assistantRow.model || undefined,
        messages: currentMessages,
        tools,
        // on laisse le service openai gérer la compat modèle (gpt-4.1-nano n'a pas reasoning.summary)
        reasoningSummary: 'detailed',
        reasoningEffort: reasoningEffortForThisMessage,
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
          lastErrorMessage = typeof msg === 'string' ? msg : 'Unknown error';
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
          if (delta) reasoningParts.push(delta);
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
        // Note: eventType 'done' est volontairement retardé (voir plus haut)
      }

      // Debug (requested): if we asked for reasoningSummary=detailed but saw none, log it.
      if (isGpt5 && reasoningParts.length === 0) {
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
        break;
      }

      // Exécuter les tool calls et ajouter les résultats à la conversation
      const toolResults: Array<{ role: 'tool'; content: string; tool_call_id: string }> = [];
      const responseToolOutputs: Array<{ type: 'function_call_output'; call_id: string; output: string }> = [];
      const pendingLocalToolCalls: Array<{ id: string; name: string }> = [];
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

      for (const toolCall of toolCalls) {
        if (options.signal?.aborted) throw new Error('AbortError');
        const toolName = String(toolCall.name || '').trim();
        if (toolName && localToolNames.has(toolName)) {
          pendingLocalToolCalls.push({ id: toolCall.id, name: toolName });
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
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
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
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
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
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
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
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
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
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id,
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
            output: JSON.stringify(result)
          });
        } catch (error) {
          const errorResult = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
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
            output: JSON.stringify(errorResult)
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
        model: options.model || assistantRow.model || null,
        toolChoice: 'auto',
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
              name: item.name
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
              output: item.output
            }))
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

      // Appel suivant: on enverra `responseToolOutputs` via rawInput, rattaché à previous_response_id.
      // NOTE: on n'envoie PAS de "nudge" ici: on teste d'abord le pattern doc-compatible.
      pendingResponsesRawInput = responseToolOutputs;
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
          model: options.model || assistantRow.model || null,
          toolChoice: 'none',
          tools: null,
          openaiMessages: pass2Messages,
          toolCalls: null,
          meta: { kind: 'pass2_prompt', callSite: 'ChatService.runAssistantGeneration/pass2/beforeOpenAI', openaiApi: 'responses' }
        });

        for await (const event of callOpenAIResponseStream({
          model: options.model || assistantRow.model || undefined,
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
        model: options.model || assistantRow.model || null
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
