import { env } from '../config/env';
import OpenAI from "openai";

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
 * Méthode unique pour tous les appels OpenAI
 */
export const callOpenAI = async (options: CallOpenAIOptions): Promise<OpenAI.Chat.Completions.ChatCompletion> => {
  const {
    messages,
    model = 'gpt-4.1-nano',
    tools,
    toolChoice = 'auto',
    responseFormat,
    signal
  } = options;

  const requestOptions: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model,
    messages,
    ...(tools && { tools }),
    ...(toolChoice !== 'auto' && { tool_choice: toolChoice }),
    ...(responseFormat && { response_format: { type: responseFormat } })
  };

  // Pass AbortSignal through request options to enable cooperative cancellation
  return await client.chat.completions.create(requestOptions, { signal });
};