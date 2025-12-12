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
  signal?: AbortSignal;
}

export interface CallOpenAIResponseOptions {
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  model?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
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
  data: any;
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
    ...(responseFormat && { response_format: { type: responseFormat } })
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
    ...(responseFormat && { response_format: { type: responseFormat } })
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
      if ('reasoning' in delta && (delta as any).reasoning) {
        yield {
          type: 'reasoning_delta',
          data: { delta: (delta as any).reasoning }
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
  const { messages, model, reasoningEffort, tools, responseFormat, structuredOutput, signal } = options;

  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  // Convertir les messages chat en format input du Responses API
  // IMPORTANT:
  // - Le SDK définit `EasyInputMessage` (role user|assistant|system|developer) avec `content` string.
  // - Si on envoie `role:"assistant"` avec des content parts `type:"input_text"`, l'API renvoie:
  //   "Invalid value: 'input_text'. Supported values are: 'output_text' and 'refusal'."
  // => On utilise donc `content` en string pour tous les rôles.
  const input = messages.map((m) => {
    const role = (m.role === 'tool' ? 'user' : m.role) as 'user' | 'assistant' | 'system' | 'developer';
    const content = typeof (m as any).content === 'string' ? (m as any).content : JSON.stringify((m as any).content);
    return { type: 'message', role, content };
  }) as any;

  // Mapper les tools "Chat Completions" -> "Responses" (format plat)
  const responseTools = tools
    ? tools
        .filter((t) => (t as any)?.type === 'function')
        .map((t) => ({
          type: 'function',
          name: (t as any).function?.name || '',
          description: (t as any).function?.description,
          parameters: (t as any).function?.parameters ?? null,
          // IMPORTANT: en mode strict, OpenAI exige un sous-ensemble JSON Schema (ex: additionalProperties:false).
          // Pour éviter de "sur-valider" nos tools (web_search/web_extract) à ce stade, on désactive strict.
          strict: false
        }))
        .filter((t) => !!t.name)
    : undefined;

  // Structured output via Responses API: text.format
  const textConfig =
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

  const requestOptions: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model: selectedModel,
    stream: true,
    input,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    ...(responseTools ? { tools: responseTools as any } : {}),
    ...(textConfig ? { text: textConfig as any } : {})
  };

  try {
    yield { type: 'status', data: { state: 'started' } };

    const stream = await client.responses.create(requestOptions, { signal });

    // Suivre les tool calls par item_id (Responses API)
    const toolCallState = new Map<string, { started: boolean; sawDelta: boolean; name?: string }>();

    for await (const chunk of stream) {
      if (signal?.aborted) {
        yield { type: 'error', data: { message: 'Stream aborted' } };
        return;
      }

      const type = (chunk as any).type as string | undefined;
      if (!type) continue;

      // IMPORTANT:
      // - Ne jamais traiter `chunk.delta` comme du texte final sans vérifier `type`,
      //   sinon on concatène les arguments JSON des tool calls (cf. réponse Boeing).
      switch (type) {
        case 'response.reasoning_text.delta': {
          const delta = (chunk as any).delta as string | undefined;
          if (delta) yield { type: 'reasoning_delta', data: { delta } };
          break;
        }
        case 'response.output_text.delta': {
          const delta = (chunk as any).delta as string | undefined;
          if (delta) yield { type: 'content_delta', data: { delta } };
          break;
        }
        case 'response.output_item.added': {
          const item = (chunk as any).item;
          // Tool call "function_call"
          if (item?.type === 'function_call') {
            const toolCallId = item.id || item.call_id || '';
            const name = item.name || '';
            const args = item.arguments || '';
            if (toolCallId) {
              toolCallState.set(toolCallId, { started: true, sawDelta: false, name });
            }
            yield { type: 'tool_call_start', data: { tool_call_id: toolCallId, name, args } };
          }
          break;
        }
        case 'response.function_call_arguments.delta': {
          const toolCallId = (chunk as any).item_id as string | undefined;
          const delta = (chunk as any).delta as string | undefined;
          if (!toolCallId || !delta) break;
          const state = toolCallState.get(toolCallId) || { started: false, sawDelta: false };
          state.sawDelta = true;
          toolCallState.set(toolCallId, state);
          yield { type: 'tool_call_delta', data: { tool_call_id: toolCallId, delta } };
          break;
        }
        case 'response.function_call_arguments.done': {
          const toolCallId = (chunk as any).item_id as string | undefined;
          const name = (chunk as any).name as string | undefined;
          const args = (chunk as any).arguments as string | undefined;
          if (!toolCallId) break;
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
          const message = (chunk as any).error?.message || 'Unknown error';
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