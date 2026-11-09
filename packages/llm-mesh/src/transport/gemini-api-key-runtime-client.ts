import type { GeminiAdapterClient } from '../adapters.js';
import type { GenerateRequest, GenerateResponse, StreamRequest, StreamResult } from '../generation.js';
import type { LlmMeshMessage } from '../messages.js';
import type { ProviderRuntimeContext } from '../registry.js';
import type { FinishReason, StreamEvent, TokenUsage } from '../streaming.js';
import type { ToolCall } from '../tools.js';

export interface GeminiApiKeyRuntimeClientOptions {
  readonly apiKey: string;
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string;
  readonly modelId?: string;
  readonly originator?: string;
  readonly userAgent?: string;
}

// Serving wire facts [DOCUMENTED] from the Generative Language API
// (generativelanguage.googleapis.com): POST
// /v1beta/models/{model}:generateContent, header
// `x-goog-api-key: <api_key>`, request body
// { contents: [{ role, parts }], systemInstruction?, tools?, toolConfig?,
// generationConfig? }, response
// { candidates: [{ content: { parts }, finishReason }], usageMetadata? }.
const GEMINI_API_KEY_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const GEMINI_API_KEY_DEFAULT_MODEL_ID = 'gemini-3.8-flash';

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

const numOf = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const hasHeaderValue = (value: string): boolean =>
  value.trim().length > 0 && !/[\r\n]/.test(value);

// Mesh history projected onto the GenerateContent wire: system/developer
// messages become the systemInstruction, user/assistant/tool messages become
// contents. Reasoning parts map to thought parts; images to inlineData;
// file parts without bytes are omitted (no documented file-uri slot).
const toWireParts = (message: LlmMeshMessage): Array<Record<string, unknown>> => {
  if (typeof message.content === 'string') return [{ text: message.content }];
  const parts: Array<Record<string, unknown>> = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push({ text: part.text });
    } else if (part.type === 'reasoning') {
      parts.push({
        text: part.text,
        thought: true,
        ...(part.signature ? { thoughtSignature: part.signature } : {}),
      });
    } else if (part.type === 'image') {
      if (part.data) {
        parts.push({ inlineData: { mimeType: part.mediaType ?? 'image/png', data: part.data } });
      } else if (part.url) {
        parts.push({ fileData: { mimeType: part.mediaType ?? 'image/png', fileUri: part.url } });
      }
    } else if (part.data) {
      parts.push({ inlineData: { mimeType: part.mediaType ?? 'application/octet-stream', data: part.data } });
    }
  }
  return parts;
};

const toWireContents = (messages: readonly LlmMeshMessage[]): Array<Record<string, unknown>> => {
  const contents: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role === 'system' || message.role === 'developer') continue;
    if (message.role === 'tool') {
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: message.toolResult.name ?? 'tool',
            response: message.toolResult.output ?? null,
          },
        }],
      });
      continue;
    }
    const parts = toWireParts(message);
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) {
        let args: unknown = null;
        try {
          args = call.arguments ?? JSON.parse(call.argumentsText);
        } catch {
          args = call.argumentsText;
        }
        parts.push({ functionCall: { name: call.name, args: asRecord(args) ?? {} } });
      }
    }
    contents.push({ role: message.role === 'assistant' ? 'model' : 'user', parts });
  }
  return contents;
};

const toWireBody = (request: GenerateRequest): Record<string, unknown> => {
  const systemParts = request.messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .flatMap(toWireParts);
  const functionDeclarations = request.tools?.map((tool) => ({
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
  }));
  const toolChoice = request.toolChoice;
  return {
    contents: toWireContents(request.messages),
    ...(systemParts.length > 0 ? { systemInstruction: { parts: systemParts } } : {}),
    ...(functionDeclarations?.length ? { tools: [{ functionDeclarations }] } : {}),
    ...(toolChoice === 'none'
      ? { toolConfig: { functionCallingConfig: { mode: 'NONE' } } }
      : toolChoice === 'required' || (typeof toolChoice === 'object' && toolChoice.type === 'tool')
        ? {
          toolConfig: {
            functionCallingConfig: {
              mode: 'ANY',
              ...(typeof toolChoice === 'object'
                ? { allowedFunctionNames: [toolChoice.name] }
                : {}),
            },
          },
        }
        : {}),
    generationConfig: {
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.topP !== undefined ? { topP: request.topP } : {}),
      ...(request.maxOutputTokens !== undefined ? { maxOutputTokens: request.maxOutputTokens } : {}),
      ...(request.responseFormat?.type === 'json-object' || request.responseFormat?.type === 'json-schema'
        ? { responseMimeType: 'application/json' }
        : {}),
      ...(request.responseFormat?.type === 'json-schema'
        ? { responseSchema: request.responseFormat.schema }
        : {}),
    },
  };
};
