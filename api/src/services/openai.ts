import { env } from '../config/env';
import OpenAI from "openai";
import { settingsService } from './settings';

// Initialiser le client OpenAI
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY! });

export interface CallOpenAIOptions {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  responseFormat?: 'json_object';
  /**
   * Chat Completions: max output tokens for the assistant message.
   * If not set, OpenAI may use a small default which can truncate long outputs.
   */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface CallOpenAIResponseOptions {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
  /**
   * Responses API: permet de "continuer" une réponse précédente (tool call -> tool output -> continuation).
   * Si fourni, `rawInput` doit contenir uniquement les items additionnels (ex: function_call_output).
   */
  previousResponseId?: string;
  /**
   * Overrides `messages` conversion for Responses API. Use to send tool outputs properly:
   * [{ type:'function_call_output', call_id:'...', output:'...' }, ...]
   */
  rawInput?: unknown[];
  // Shorthand (mode JSON "legacy") — utile pour conserver l'API existante
  responseFormat?: 'json_object';
  // Structured Outputs (préféré): JSON Schema strict (subset) supporté par OpenAI
  structuredOutput?: {
    name: string;
    schema: Record<string, unknown>;
    description?: string;
    strict?: boolean;
  };
  toolChoice?: 'auto' | 'required' | 'none'; // laissé pour compat mais on n'impose rien (auto)
  /**
   * Responses API: max output tokens for the assistant output.
   * If not set, OpenAI may use a small default which can truncate long outputs.
   */
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Types d'événements de streaming normalisés
 */
export type StreamEventType = 
  | 'reasoning_delta' 
  | 'content_delta' 
  | 'tool_call_start' 
  | 'tool_call_delta' 
  | 'tool_call_result' 
  | 'status' 
  | 'error' 
  | 'done';

export interface StreamEvent {
  type: StreamEventType;
  data: unknown;
}

/**
 * Méthode unique pour tous les appels OpenAI (non-streaming)
 */
export const callOpenAI = async (options: CallOpenAIOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
  const {
    messages,
    model,
    tools,
    toolChoice = 'auto',
    responseFormat,
    maxOutputTokens,
    signal
  } = options;

  // Récupérer le modèle par défaut depuis les settings si non fourni
  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model: selectedModel,
    messages,
    ...(tools && { tools }),
    ...(toolChoice !== 'auto' && { tool_choice: toolChoice }),
    ...(responseFormat && { response_format: { type: responseFormat } }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? { max_tokens: Math.floor(maxOutputTokens) }
      : {})
  };

  // Pass AbortSignal through request options to enable cooperative cancellation
  return await client.chat.completions.create(requestOptions, { signal });
};

/**
 * Méthode pour les appels OpenAI en streaming
 * Retourne un AsyncIterable de StreamEvent normalisés
 */
export async function* callOpenAIStream(
  options: CallOpenAIOptions
): AsyncGenerator<StreamEvent, void, unknown> {
  const {
    messages,
    model,
    tools,
    toolChoice = 'auto',
    responseFormat,
    maxOutputTokens,
    signal
  } = options;

  // Récupérer le modèle par défaut depuis les settings si non fourni
  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
    model: selectedModel,
    messages,
    stream: true,
    ...(tools && { tools }),
    ...(toolChoice !== 'auto' && { tool_choice: toolChoice }),
    ...(responseFormat && { response_format: { type: responseFormat } }),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? { max_tokens: Math.floor(maxOutputTokens) }
      : {})
  };

  // État pour tracker les tool calls en cours
  const toolCallsInProgress = new Map<string, {
    id: string;
    name: string;
    args: string;
  }>();

  try {
    // Envoyer un événement status 'started'
    yield { type: 'status', data: { state: 'started' } };

    const stream = await client.chat.completions.create(requestOptions, { signal });

    for await (const chunk of stream) {
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Stream aborted' } };
        return;
      }

      const choice = chunk.choices[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Gérer le reasoning (pour modèles comme o1, o3, gpt-5)
      // Le reasoning peut être dans delta.reasoning ou dans un champ spécifique
      // Vérifier si le chunk contient des informations de reasoning
      // Note: La structure exacte dépend de la version de l'API OpenAI
      const reasoning = (delta as unknown as { reasoning?: unknown }).reasoning;
      if (typeof reasoning === 'string' && reasoning) {
        yield {
          type: 'reasoning_delta',
          data: { delta: reasoning }
        };
      }

      // Gérer le contenu (content)
      if (delta.content) {
        yield {
          type: 'content_delta',
          data: { delta: delta.content }
        };
      }

      // Gérer les tool calls
      if (delta.tool_calls) {
        for (const toolCallDelta of delta.tool_calls) {
          const toolCallId = toolCallDelta.id;
          const toolCallIndex = toolCallDelta.index;

          // Utiliser index comme clé si id n'est pas encore disponible
          const trackingKey = toolCallId || `index_${toolCallIndex}`;

          // Nouveau tool call : index est défini et on n'a pas encore vu ce tool call
          if (toolCallIndex !== undefined && !toolCallsInProgress.has(trackingKey)) {
            const toolCallData = {
              id: toolCallId || '',
              name: toolCallDelta.function?.name || '',
              args: toolCallDelta.function?.arguments || ''
            };
            
            toolCallsInProgress.set(trackingKey, toolCallData);

            // Si on a maintenant un id, mettre à jour la clé
            if (toolCallId && trackingKey !== toolCallId) {
              toolCallsInProgress.delete(trackingKey);
              toolCallsInProgress.set(toolCallId, toolCallData);
            }

            yield {
              type: 'tool_call_start',
              data: {
                tool_call_id: toolCallId || trackingKey,
                name: toolCallDelta.function?.name || '',
                args: toolCallDelta.function?.arguments || ''
              }
            };
          }

          // Delta d'arguments pour un tool call existant
          if (toolCallDelta.function?.arguments) {
            const existing = toolCallsInProgress.get(toolCallId || trackingKey);
            if (existing) {
              existing.args += toolCallDelta.function.arguments;
              
              yield {
                type: 'tool_call_delta',
                data: {
                  tool_call_id: toolCallId || trackingKey,
                  delta: toolCallDelta.function.arguments
                }
              };
            }
          }

          // Mettre à jour le name si présent
          if (toolCallDelta.function?.name) {
            const existing = toolCallsInProgress.get(toolCallId || trackingKey);
            if (existing && !existing.name) {
              existing.name = toolCallDelta.function.name;
            }
          }
        }
      }

      // Fin du stream (finish_reason indique la fin)
      if (choice.finish_reason) {
        // Nettoyer les tool calls en cours
        toolCallsInProgress.clear();
        
        yield { type: 'done', data: {} };
        return;
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    yield { type: 'error', data: { message: errorMessage } };
    throw error;
  }
}

/**
 * Streaming via Responses API (support reasoning, modèle unique)
 * - N'injecte pas de reasoning.effort par défaut (on ne le spécifie que si demandé)
 */
export async function* callOpenAIResponseStream(
  options: CallOpenAIResponseOptions
): AsyncGenerator<StreamEvent, void, unknown> {
  const {
    messages,
    model,
    reasoningEffort,
    reasoningSummary,
    tools,
    responseFormat,
    structuredOutput,
    maxOutputTokens,
    signal,
    previousResponseId,
    rawInput
  } = options;

  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  // Certains modèles (ex: gpt-4.1-nano-*) ne supportent pas `reasoning.summary`.
  // On désactive complètement `reasoning` pour ces familles afin d'éviter un 400.
  const supportsReasoningParams = !selectedModel.startsWith('gpt-4.1');

  // Convertir les messages chat en format input du Responses API
  // IMPORTANT:
  // - Le SDK définit `EasyInputMessage` (role user|assistant|system|developer) avec `content` string.
  // - Si on envoie `role:"assistant"` avec des content parts `type:"input_text"`, l'API renvoie:
  //   "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'."
  // => On utilise donc `content` en string pour tous les rôles.
  const input: OpenAI.Responses.ResponseCreateParamsStreaming['input'] = (rawInput && rawInput.length > 0)
    ? (rawInput as OpenAI.Responses.ResponseCreateParamsStreaming['input'])
    : messages.map((m) => {
        const role = (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system' | 'developer';
        const contentRaw = (m as unknown as { content?: unknown }).content;
        const content = typeof contentRaw === 'string' ? contentRaw : JSON.stringify(contentRaw ?? '');
        return { type: 'message', role, content };
      });

  // Mapper les tools "Chat Completions" -> "Responses" (format plat)
  const responseTools: OpenAI.Responses.ResponseCreateParamsStreaming['tools'] | undefined = tools
    ? (tools
        .filter((t) => t.type === 'function')
        .map((t) => ({
          type: 'function' as const,
          name: t.function?.name || '',
          description: t.function?.description,
          parameters: t.function?.parameters ?? null,
          // IMPORTANT: en mode strict, OpenAI exige un sous-ensemble JSON Schema (ex: additionalProperties:false).
          // Pour éviter de "sur-valider" nos tools (web_search/web_extract) à ce stade, on désactive strict.
          strict: false
        }))
        .filter((t) => !!t.name) as unknown as OpenAI.Responses.ResponseCreateParamsStreaming['tools'])
    : undefined;

  // Structured output via Responses API: text.format
  const textConfig: OpenAI.Responses.ResponseCreateParamsStreaming['text'] | undefined =
    structuredOutput
      ? {
          format: {
            type: 'json_schema',
            name: structuredOutput.name,
            schema: structuredOutput.schema,
            description: structuredOutput.description,
            strict: structuredOutput.strict ?? true
          }
        }
      : responseFormat
        ? { format: { type: responseFormat } }
        : undefined;

  const reasoning: OpenAI.Responses.ResponseCreateParamsStreaming['reasoning'] | undefined =
    supportsReasoningParams
      ? {
          summary: reasoningSummary ?? 'auto',
          ...(reasoningEffort ? { effort: reasoningEffort } : {})
        }
      : undefined;

  const requestOptions: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model: selectedModel,
    stream: true,
    input,
    ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(responseTools ? { tools: responseTools } : {}),
    ...(textConfig ? { text: textConfig } : {}),
    ...(typeof maxOutputTokens === 'number' && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0
      ? { max_output_tokens: Math.floor(maxOutputTokens) }
      : {})
  };

  try {
    yield { type: 'status', data: { state: 'started' } };

    const stream = await client.responses.create(requestOptions, { signal });

    // Suivre les tool calls par item_id (Responses API)
    const toolCallState = new Map<string, { started: boolean; sawDelta: boolean; name?: string }>();
    // Responses API: `function_call_output` doit cibler `call_id` (souvent "call_..."), pas forcément `item.id`.
    // On maintient un mapping item_id -> public_tool_call_id (call_id si disponible).
    const itemIdToCallId = new Map<string, string>();

    for await (const chunk of stream) {
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Stream aborted' } };
        return;
      }

      const record = chunk as unknown as Record<string, unknown>;
      const type = typeof record.type === 'string' ? record.type : undefined;
      if (!type) continue;

      // IMPORTANT:
      // - Ne jamais traiter `chunk.delta` comme du texte final sans vérifier `type`,
      //   sinon on concatène les arguments JSON des tool calls (cf. réponse Boeing).
      switch (type) {
        case 'response.created': {
          // Expose response_id for orchestration (previous_response_id continuation)
          const response = (record as Record<string, unknown>).response as Record<string, unknown> | undefined;
          const responseId =
            (response && typeof response.id === 'string' && response.id) ||
            (typeof (record as Record<string, unknown>).response_id === 'string' && ((record as Record<string, unknown>).response_id as string)) ||
            (typeof (record as Record<string, unknown>).id === 'string' && ((record as Record<string, unknown>).id as string)) ||
            '';
          if (responseId) yield { type: 'status', data: { state: 'response_created', response_id: responseId } };
          break;
        }
        case 'response.reasoning_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) yield { type: 'reasoning_delta', data: { delta } };
          break;
        }
        case 'response.reasoning_summary_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) yield { type: 'reasoning_delta', data: { delta, kind: 'summary' } };
          break;
        }
        case 'response.reasoning_summary_text.done': {
          const text = typeof record.text === 'string' ? record.text : undefined;
          if (text) yield { type: 'reasoning_delta', data: { delta: text, kind: 'summary_done' } };
          break;
        }
        case 'response.output_text.delta': {
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (delta) yield { type: 'content_delta', data: { delta } };
          break;
        }
        case 'response.output_item.added': {
          const item = record.item as unknown;
          const itemRec = item as Record<string, unknown> | null;
          // Tool call "function_call"
          if (itemRec && itemRec.type === 'function_call') {
            const itemId = (typeof itemRec.id === 'string' && itemRec.id) ? itemRec.id : '';
            const callId = (typeof itemRec.call_id === 'string' && itemRec.call_id) ? itemRec.call_id : '';
            // Public id used throughout our system: prefer call_id (required for function_call_output).
            const toolCallId = callId || itemId || '';
            const name = typeof itemRec.name === 'string' ? itemRec.name : '';
            const args = typeof itemRec.arguments === 'string' ? itemRec.arguments : '';
            if (itemId && toolCallId) {
              itemIdToCallId.set(itemId, toolCallId);
            }
            if (toolCallId) toolCallState.set(toolCallId, { started: true, sawDelta: false, name });
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name, args } };
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const itemId = typeof record.item_id === 'string' ? record.item_id : undefined;
          const delta = typeof record.delta === 'string' ? record.delta : undefined;
          if (!itemId || !delta) break;
          const toolCallId = itemIdToCallId.get(itemId) || itemId;
          const state = toolCallState.get(toolCallId) || { started: false, sawDelta: false };
          state.sawDelta = true;
          toolCallState.set(toolCallId, state);
          yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta } };
          break;
        }
        case 'response.function_call_arguments.done': {
          const itemId = typeof record.item_id === 'string' ? record.item_id : undefined;
          const name = typeof record.name === 'string' ? record.name : undefined;
          const args = typeof record.arguments === 'string' ? record.arguments : undefined;
          if (!itemId) break;
          const toolCallId = itemIdToCallId.get(itemId) || itemId;
          const state = toolCallState.get(toolCallId) || { started: false, sawDelta: false };
          // Fallback: certains flux peuvent ne pas émettre de delta, uniquement "done"
          if (!state.started) {
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name: name || '', args: args || '' } };
          } else if (!state.sawDelta && args) {
            yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta: args } };
          }
          toolCallState.set(toolCallId, { started: true, sawDelta: true, name: name || state.name });
          break;
        }
        case 'response.error': {
          const err = record.error as unknown;
          const errRec = err as Record<string, unknown> | null;
          const message =
            (errRec && typeof errRec.message === 'string' && errRec.message) ? errRec.message : 'Unknown error';
          yield { type: 'error', data: { message } };
          break;
        }
        case 'response.completed': {
          yield { type: 'done', data: {} };
          return;
        }
        default: {
          // Ignorer les autres events (output_text.done, output_item.done, etc.)
          break;
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    yield { type: 'error', data: { message: errorMessage } };
    throw error;
  }
}