import { and, asc, desc, eq, sql, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { ADMIN_WORKSPACE_ID, chatMessages, chatSessions, chatStreamEvents } from '../db/schema';
import { createId } from '../utils/id';
import { callOpenAIResponseStream, type StreamEventType } from './openai';
import { getNextSequence, writeStreamEvent } from './stream-service';
import { settingsService } from './settings';
import { readUseCaseTool, updateUseCaseFieldTool, webSearchTool, webExtractTool, searchWeb, extractUrlContent } from './tools';
import { toolService } from './tool-service';
import { ensureWorkspaceForUser } from './workspace-service';
import { env } from '../config/env';
import { writeChatGenerationTrace } from './chat-trace';

export type ChatContextType = 'company' | 'folder' | 'usecase' | 'executive_summary';

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

    const ownerWs = await ensureWorkspaceForUser(options.userId);
    const sessionWorkspaceId =
      session && typeof (session as { workspaceId?: unknown }).workspaceId === 'string'
        ? ((session as { workspaceId: string }).workspaceId as string)
        : ownerWs.workspaceId;
    // Read-only mode when the chat session is scoped to a different workspace,
    // except for the Admin Workspace (admin_app only can target it via API).
    const readOnly = sessionWorkspaceId !== ownerWs.workspaceId && sessionWorkspaceId !== ADMIN_WORKSPACE_ID;

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
    const tools =
      primaryContextType === 'usecase'
        ? [
            readUseCaseTool,
            ...(readOnly ? [] : [updateUseCaseFieldTool]),
            webSearchTool,
            webExtractTool
          ]
        : undefined;

    // Enrichir le system prompt avec le contexte si disponible
    let systemPrompt = "Tu es un assistant IA pour une application B2B d'idées d'IA. Réponds en français, de façon concise et actionnable.";
    if (primaryContextType === 'usecase' && primaryContextId) {
      systemPrompt += ` 

Tu travailles sur le use case ${primaryContextId}. Tu peux répondre aux questions générales de l'utilisateur en t'appuyant sur l'historique de la conversation.

Tools disponibles :
- \`read_usecase\` : Lit l'état actuel du use case
- \`update_usecase_field\` : Met à jour des champs du use case (modifications appliquées directement en DB)${readOnly ? ' (DÉSACTIVÉ en mode lecture seule)' : ''}
- \`web_search\` : Recherche d'informations récentes sur le web pour trouver de nouvelles URLs ou obtenir des résumés. Utilise ce tool quand tu dois chercher de nouvelles informations ou URLs pertinentes.
- \`web_extract\` : Extrait le contenu complet d'une ou plusieurs URLs existantes. CRITIQUE : Utilise ce tool quand l'utilisateur demande des détails sur les références (URLs déjà présentes dans le use case). Si tu dois extraire plusieurs URLs (par exemple 9 URLs), tu DOIS toutes les passer dans UN SEUL appel avec le paramètre \`urls\` en array. NE FAIS JAMAIS plusieurs appels séparés (un par URL). Exemple : si tu as 9 URLs, appelle une seule fois avec \`{"urls": ["url1", "url2", ..., "url9"]}\` au lieu de faire 9 appels séparés.

Quand l'utilisateur demande explicitement de modifier, reformuler ou mettre à jour des champs du use case (par exemple : "reformuler le problème", "mettre en bullet points", "modifier la description"), tu DOIS utiliser les tools disponibles :
1. D'abord utiliser \`read_usecase\` pour lire l'état actuel du use case
2. Ensuite utiliser \`update_usecase_field\` pour appliquer directement les modifications demandées${readOnly ? ' (si disponible; sinon, propose une suggestion sans modifier en DB)' : ''}

Les modifications sont appliquées immédiatement en base de données via les tools. Ne réponds pas simplement dans le texte quand il s'agit de modifier le use case, utilise les tools pour effectuer les modifications réelles.

Si l'utilisateur demande une confirmation avant modification, propose alors les modifications dans le chat et attends sa validation avant d'utiliser les tools.

Tu peux utiliser \`web_search\` et \`web_extract\` pour enrichir les références du use case :
- \`web_search\` : Pour rechercher de nouvelles informations ou URLs pertinentes sur le web (tu obtiens des résumés et des URLs de résultats)
- \`web_extract\` : Pour extraire le contenu complet des URLs déjà présentes dans le use case.

**Workflow pour analyser les références** : Si l'utilisateur demande des détails sur les références (par exemple "regarde les références en détail", "résume les références"), tu DOIS :
1. D'abord appeler \`read_usecase\` pour lire le use case et obtenir les références dans \`data.references\` (qui est un array d'objets \`{title: string, url: string}\`)
2. Extraire toutes les URLs depuis \`data.references\` (chaque objet a une propriété \`url\`) et les mettre dans un array
3. Appeler \`web_extract\` UNE SEULE FOIS avec TOUTES les URLs dans le paramètre \`urls\`. Exemple concret : si \`data.references\` contient 9 objets avec des URLs, tu dois appeler \`web_extract\` une seule fois avec \`{"urls": ["https://url1.com", "https://url2.com", "https://url3.com", ..., "https://url9.com"]}\`. NE FAIS JAMAIS 9 appels séparés avec une URL chacun.
4. Utiliser le contenu extrait (qui sera dans \`result.results\`, un array d'objets \`{url: string, content: string}\`) pour répondre à la demande de l'utilisateur

Exemple concret : Si l'utilisateur dit "Je souhaite reformuler Problème et solution en bullet point", tu dois :
1. Appeler read_usecase pour lire le use case actuel
2. Appeler update_usecase_field avec les modifications (par exemple : path: 'problem', path: 'solution')
3. Les modifications sont alors appliquées directement en base de données`;
    }

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

          if (toolCall.name === 'read_usecase') {
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
          } else if (toolCall.name === 'update_usecase_field') {
            if (readOnly) {
              throw new Error('Read-only workspace: update_usecase_field is disabled');
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


