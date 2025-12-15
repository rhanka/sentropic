import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { chatMessages, chatSessions } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAIResponseStream, type StreamEventType } from './openai';
import { getNextSequence, writeStreamEvent } from './stream-service';
import { settingsService } from './settings';

export type ChatContextType = 'company' | 'folder' | 'usecase' | 'executive_summary';

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export type CreateChatSessionInput = {
  userId: string;
  primaryContextType?: ChatContextType | null;
  primaryContextId?: string | null;
  title?: string | null;
};

export type CreateChatMessageInput = {
  userId: string;
  sessionId?: string | null;
  content: string;
  model?: string | null;
  primaryContextType?: ChatContextType | null;
  primaryContextId?: string | null;
  sessionTitle?: string | null;
};

export class ChatService {
  async getMessageForUser(messageId: string, userId: string) {
    const [row] = await db
      .select({
        id: chatMessages.id,
        sessionId: chatMessages.sessionId,
        role: chatMessages.role
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
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.sequence));
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
    const sessionId =
      input.sessionId && (await this.getSessionForUser(input.sessionId, input.userId))
        ? input.sessionId
        : (await this.createSession({
            userId: input.userId,
            primaryContextType: input.primaryContextType ?? null,
            primaryContextId: input.primaryContextId ?? null,
            title: input.sessionTitle ?? null
          })).sessionId;

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
    signal?: AbortSignal;
  }): Promise<void> {
    const session = await this.getSessionForUser(options.sessionId, options.userId);
    if (!session) throw new Error('Session not found');

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

    const systemPrompt =
      "Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.";

    let streamSeq = await getNextSequence(options.assistantMessageId);
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];

    for await (const event of callOpenAIResponseStream({
      model: options.model || assistantRow.model || undefined,
      messages: [{ role: 'system', content: systemPrompt }, ...conversation],
      // on laisse le service openai gérer la compat modèle (gpt-4.1-nano n'a pas reasoning.summary)
      reasoningSummary: 'detailed',
      signal: options.signal
    })) {
      const eventType = event.type as StreamEventType;
      await writeStreamEvent(options.assistantMessageId, eventType, event.data, streamSeq, options.assistantMessageId);
      streamSeq += 1;

      if (eventType === 'content_delta') {
        const delta = (event.data as { delta?: string }).delta;
        if (typeof delta === 'string') contentParts.push(delta);
      } else if (eventType === 'reasoning_delta') {
        const delta = (event.data as { delta?: string }).delta;
        if (typeof delta === 'string') reasoningParts.push(delta);
      }
    }

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


