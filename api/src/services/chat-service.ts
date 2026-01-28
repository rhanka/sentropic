import { and, asc, desc, eq, sql, inArray, isNotNull, gt, or } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { chatMessageFeedback, chatMessages, chatSessions, chatStreamEvents, contextDocuments, folders } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAI, callOpenAIResponseStream, type StreamEventType } from './openai';
import { getNextSequence, writeStreamEvent } from './stream-service';
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
  documentsTool
} from './tools';
import { toolService } from './tool-service';
import { ensureWorkspaceForUser } from './workspace-service';
import { hasWorkspaceRole, isWorkspaceDeleted } from './workspace-access';
import { env } from '../config/env';
import { writeChatGenerationTrace } from './chat-trace';

export type ChatContextType = 'organization' | 'folder' | 'usecase' | 'executive_summary';

const CHAT_CONTEXT_TYPES = ['organization', 'folder', 'usecase', 'executive_summary'] as const;
function isChatContextType(value: unknown): value is ChatContextType {
  return typeof value === 'string' && (CHAT_CONTEXT_TYPES as readonly string[]).includes(value);
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
  sessionTitle?: string | null;
};

export class ChatService {
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

    // Documents tool is only exposed if there are documents attached to the current context.
    const allowedDocContexts = await this.getAllowedDocumentsContexts({
      primaryContextType,
      primaryContextId,
      workspaceId: sessionWorkspaceId,
      sessionId: session.id,
      extraContexts: contextsOverride
    });

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
    tools = toolSet.size > 0 ? Array.from(toolSet.values()) : hasDocuments ? [documentsTool] : undefined;

    if (Array.isArray(options.tools) && options.tools.length > 0 && tools?.length) {
      const allowed = new Set(options.tools);
      tools = tools.filter((t) => (t.type === 'function' ? allowed.has(t.function?.name || '') : false));
      if (tools.length === 0) tools = undefined;
    }

    const contextLabel = (type: string, id: string) => {
      if (type === 'chat_session') return `Session de chat (${id})`;
      return `${type}:${id}`;
    };

    const documentsBlock = await (async () => {
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
    let previousResponseId: string | null = null;
    let pendingResponsesRawInput: unknown[] | null = null;

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

      for (const toolCall of toolCalls) {
        if (options.signal?.aborted) throw new Error('AbortError');
        
        try {
          const args = JSON.parse(toolCall.args || '{}');
          let result: unknown;

          if (toolCall.name === 'read_usecase' || toolCall.name === 'usecase_get') {
            // Vérifier la sécurité : useCaseId doit correspondre au contexte
            if (primaryContextType !== 'usecase' || args.useCaseId !== primaryContextId) {
              throw new Error('Security: useCaseId does not match session context');
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
            // Vérifier la sécurité : useCaseId doit correspondre au contexte
            if (primaryContextType !== 'usecase' || args.useCaseId !== primaryContextId) {
              throw new Error('Security: useCaseId does not match session context');
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
            if (primaryContextType !== 'organization') {
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
            // organization context: must match context id
            if (primaryContextType === 'organization') {
              if (!primaryContextId || args.organizationId !== primaryContextId) {
                throw new Error('Security: organizationId does not match session context');
              }
            } else if (primaryContextType === 'folder' || primaryContextType === 'executive_summary') {
              // folder/executive_summary context: only allow reading the organization linked to the current folder
              if (!primaryContextId) throw new Error('Security: organization_get requires a folder context id');
              const folder = await toolService.getFolder(primaryContextId, {
                workspaceId: sessionWorkspaceId,
                select: ['organizationId']
              });
              const folderOrganizationId = typeof (folder.data as Record<string, unknown>)?.organizationId === 'string'
                ? ((folder.data as Record<string, unknown>).organizationId as string)
                : null;
              if (!folderOrganizationId) throw new Error('Folder has no organizationId');
              if (args.organizationId !== folderOrganizationId) {
                throw new Error('Security: organizationId is not linked to current folder');
              }
            } else {
              throw new Error('Security: organization_get is not available in this context');
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
            if (primaryContextType !== 'organization' || !primaryContextId || args.organizationId !== primaryContextId) {
              throw new Error('Security: organizationId does not match session context');
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
            if (primaryContextType !== 'organization' && primaryContextType !== 'folder') {
              throw new Error('Security: folders_list is only available in organization/folder context');
            }
            const organizationId =
              primaryContextType === 'organization' && primaryContextId
                ? primaryContextId
                : (typeof args.organizationId === 'string' ? args.organizationId : null);
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
            // Folder detail contexts: enforce matching. Folder list context (primaryContextId null): allow reading any folderId (workspace-scoped).
            if (primaryContextType !== 'folder' && primaryContextType !== 'executive_summary') {
              throw new Error('Security: folder_get is only available in folder/executive_summary context');
            }
            if (primaryContextType === 'executive_summary') {
              if (!primaryContextId || args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
            } else if (primaryContextType === 'folder' && primaryContextId) {
              if (args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
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
            if (primaryContextType !== 'folder' || !primaryContextId || args.folderId !== primaryContextId) {
              throw new Error('Security: folderId does not match session context');
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
            // Folder detail contexts: enforce matching. Folder list context (primaryContextId null): allow listing any folderId (workspace-scoped).
            if (primaryContextType !== 'folder' && primaryContextType !== 'executive_summary') {
              throw new Error('Security: usecases_list is only available in folder/executive_summary context');
            }
            if (primaryContextType === 'executive_summary') {
              if (!primaryContextId || args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
            } else if (primaryContextType === 'folder' && primaryContextId) {
              if (args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
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
            // Folder detail contexts: enforce matching. Folder list context (primaryContextId null): allow reading any folderId (workspace-scoped).
            if (primaryContextType !== 'folder' && primaryContextType !== 'executive_summary') {
              throw new Error('Security: executive_summary_get is only available in folder/executive_summary context');
            }
            if (primaryContextType === 'executive_summary') {
              if (!primaryContextId || args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
            } else if (primaryContextType === 'folder' && primaryContextId) {
              if (args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
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
            if ((primaryContextType !== 'folder' && primaryContextType !== 'executive_summary') || !primaryContextId || args.folderId !== primaryContextId) {
              throw new Error('Security: folderId does not match session context');
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
            // Folder detail contexts: enforce matching. Folder list context (primaryContextId null): allow reading any folderId (workspace-scoped).
            if (primaryContextType !== 'folder' && primaryContextType !== 'executive_summary') {
              throw new Error('Security: matrix_get is only available in folder/executive_summary context');
            }
            if (primaryContextType === 'executive_summary') {
              if (!primaryContextId || args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
            } else if (primaryContextType === 'folder' && primaryContextId) {
              if (args.folderId !== primaryContextId) {
                throw new Error('Security: folderId does not match session context');
              }
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
            if (primaryContextType !== 'folder' || !primaryContextId || args.folderId !== primaryContextId) {
              throw new Error('Security: folderId does not match session context');
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
}

export const chatService = new ChatService();


