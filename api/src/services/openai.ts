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

      // Gérer le reasoning (pour modèles comme o1)
      // Note: Le reasoning peut être dans delta.content pour certains modèles
      // ou dans un champ spécifique selon la version de l'API
      // Pour l'instant, on se concentre sur content_delta
      // Le reasoning sera géré plus tard si nécessaire

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