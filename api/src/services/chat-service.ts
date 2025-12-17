import { and, asc, desc, eq, sql, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { chatMessages, chatSessions, chatStreamEvents } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAIResponseStream, type StreamEventType } from './openai';
import { getNextSequence, writeStreamEvent } from './stream-service';
import { settingsService } from './settings';
import { readUseCaseTool, updateUseCaseFieldTool, webSearchTool, webExtractTool, searchWeb, extractUrlContent } from './tools';
import { toolService } from './tool-service';

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

    // Récupérer le contexte depuis la session
    const primaryContextType = session.primaryContextType;
    const primaryContextId = session.primaryContextId;

    // Préparer les tools : seulement si le contexte est 'usecase'
    const tools = primaryContextType === 'usecase' 
      ? [readUseCaseTool, updateUseCaseFieldTool, webSearchTool, webExtractTool]
      : undefined;

    // Enrichir le system prompt avec le contexte si disponible
    let systemPrompt = "Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.";
    if (primaryContextType === 'usecase' && primaryContextId) {
      systemPrompt += ` 

Tu travailles sur le use case ${primaryContextId}. Tu peux répondre aux questions générales de l'utilisateur en t'appuyant sur l'historique de la conversation.

Tools disponibles :
- \`read_usecase\` : Lit l'état actuel du use case
- \`update_usecase_field\` : Met à jour des champs du use case (modifications appliquées directement en DB)
- \`web_search\` : Recherche d'informations récentes sur le web (utile pour enrichir les références)
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs (utile pour analyser les références du use case)

Quand l'utilisateur demande explicitement de modifier, reformuler ou mettre à jour des champs du use case (par exemple : "reformuler le problème", "mettre en bullet points", "modifier la description"), tu DOIS utiliser les tools disponibles :
1. D'abord utiliser \`read_usecase\` pour lire l'état actuel du use case
2. Ensuite utiliser \`update_usecase_field\` pour appliquer directement les modifications demandées

Les modifications sont appliquées immédiatement en base de données via les tools. Ne réponds pas simplement dans le texte quand il s'agit de modifier le use case, utilise les tools pour effectuer les modifications réelles.

Si l'utilisateur demande une confirmation avant modification, propose alors les modifications dans le chat et attends sa validation avant d'utiliser les tools.

Tu peux utiliser \`web_search\` et \`web_extract\` pour enrichir les références du use case ou rechercher des informations complémentaires. Par exemple, si le use case contient des URLs dans \`references\`, tu peux utiliser \`web_extract\` pour extraire leur contenu et l'utiliser pour améliorer la description ou les détails du use case.

Exemple concret : Si l'utilisateur dit "Je souhaite reformuler Problème et solution en bullet point", tu dois :
1. Appeler read_usecase pour lire le use case actuel
2. Appeler update_usecase_field avec les modifications (par exemple : path: 'problem', path: 'solution')
3. Les modifications sont alors appliquées directement en base de données`;
    }

    let streamSeq = await getNextSequence(options.assistantMessageId);
    const contentParts: string[] = [];
    const reasoningParts: string[] = [];
    
    // État pour tracker les tool calls en cours
    const toolCalls: Array<{ id: string; name: string; args: string }> = [];
    
    // Boucle itérative pour gérer plusieurs rounds de tool calls
    let currentMessages = [{ role: 'system' as const, content: systemPrompt }, ...conversation];
    let maxIterations = 10; // Limite de sécurité pour éviter les boucles infinies
    let iteration = 0;

    while (iteration < maxIterations) {
      iteration++;
      toolCalls.length = 0; // Réinitialiser pour chaque round
      contentParts.length = 0; // Réinitialiser le contenu pour chaque round
      reasoningParts.length = 0; // Réinitialiser le reasoning pour chaque round

      let streamDone = false;

      for await (const event of callOpenAIResponseStream({
        model: options.model || assistantRow.model || undefined,
        messages: currentMessages,
        tools,
        // on laisse le service openai gérer la compat modèle (gpt-4.1-nano n'a pas reasoning.summary)
        reasoningSummary: 'detailed',
        signal: options.signal
      })) {
        const eventType = event.type as StreamEventType;
        const data = (event.data ?? {}) as Record<string, unknown>;
        await writeStreamEvent(options.assistantMessageId, eventType, data, streamSeq, options.assistantMessageId);
        streamSeq += 1;

        if (eventType === 'content_delta') {
          const delta = typeof data.delta === 'string' ? data.delta : '';
          if (delta) contentParts.push(delta);
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
        } else if (eventType === 'done' || eventType === 'error') {
          streamDone = true;
        }
      }

      // Si aucun tool call, on termine
      if (toolCalls.length === 0) {
        break;
      }

      // Exécuter les tool calls et ajouter les résultats à la conversation
      const toolResults: Array<{ role: 'tool'; content: string; tool_call_id: string }> = [];

      for (const toolCall of toolCalls) {
        if (options.signal?.aborted) throw new Error('AbortError');
        
        try {
          const args = JSON.parse(toolCall.args || '{}');
          let result: unknown;

          if (toolCall.name === 'read_usecase') {
            // Vérifier la sécurité : useCaseId doit correspondre au contexte
            if (primaryContextType !== 'usecase' || args.useCaseId !== primaryContextId) {
              throw new Error('Security: useCaseId does not match session context');
            }
            const readResult = await toolService.readUseCase(args.useCaseId);
            result = readResult;
            await writeStreamEvent(
              options.assistantMessageId,
              'tool_call_result',
              { tool_call_id: toolCall.id, result },
              streamSeq,
              options.assistantMessageId
            );
            streamSeq += 1;
          } else if (toolCall.name === 'update_usecase_field') {
            // Vérifier la sécurité : useCaseId doit correspondre au contexte
            if (primaryContextType !== 'usecase' || args.useCaseId !== primaryContextId) {
              throw new Error('Security: useCaseId does not match session context');
            }
            const updateResult = await toolService.updateUseCaseFields({
              useCaseId: args.useCaseId,
              updates: args.updates || [],
              sessionId: options.sessionId,
              messageId: options.assistantMessageId,
              toolCallId: toolCall.id
            });
            result = updateResult;
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
            const extractPromises = urls.map((url: string) => extractUrlContent(url, options.signal));
            const extractResults = await Promise.all(extractPromises);
            result = { status: 'completed', results: extractResults };
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

          // Ajouter le résultat au format OpenAI pour continuer le stream
          toolResults.push({
            role: 'tool',
            content: JSON.stringify(result),
            tool_call_id: toolCall.id
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
        }
      }

      // Ajouter les résultats des tools à la conversation pour continuer
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: contentParts.join('') },
        ...toolResults
      ];
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


