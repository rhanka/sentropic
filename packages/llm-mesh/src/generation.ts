import type { AuthInput, AuthResolver } from './auth.js';
import type { LlmMeshMessage } from './messages.js';
import type { ModelId, ModelReference, ProviderId, QualifiedModelId } from './providers.js';
import type { FinishReason, StreamEvent, TokenUsage } from './streaming.js';
import type { JsonObjectSchema, ToolCall, ToolChoice, ToolDefinition } from './tools.js';

export type ModelSelection = QualifiedModelId | ModelReference;

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json-object' }
  | {
      type: 'json-schema';
      name: string;
      schema: JsonObjectSchema;
      description?: string;
      strict?: boolean;
    };

/**
 * Reasoning effort ladder, ascending. `max` is the top rung (owner decision
 * 2026-07-25) — some upstreams expose a tier above `xhigh`; a provider that
 * does not support it should clamp to its own maximum rather than fail.
 */
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ReasoningOptions {
  effort?: ReasoningEffort;
  summary?: 'auto' | 'concise' | 'detailed';
  enabled?: boolean;
  budgetTokens?: number;
}

export interface LlmMeshRequestMetadata {
  correlationId?: string;
  userId?: string | null;
  workspaceId?: string | null;
  tenantId?: string | null;
  tags?: readonly string[];
  attributes?: Record<string, unknown>;
}

export interface GenerateRequest {
  model?: ModelSelection;
  providerId?: ProviderId;
  modelId?: ModelId;
  messages: readonly LlmMeshMessage[];
  auth?: AuthInput | AuthResolver;
  tools?: readonly ToolDefinition[];
  toolChoice?: ToolChoice;
  parallelToolCalls?: boolean;
  responseFormat?: ResponseFormat;
  reasoning?: ReasoningOptions;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  signal?: AbortSignal;
  metadata?: LlmMeshRequestMetadata;
  providerOptions?: Record<string, unknown>;
}

export interface StreamRequest extends GenerateRequest {
  previousResponseId?: string;
}

export interface GenerateResponse {
  id: string;
  providerId: ProviderId;
  modelId: ModelId;
  message: LlmMeshMessage;
  text: string;
  toolCalls: readonly ToolCall[];
  finishReason: FinishReason;
  usage?: TokenUsage;
  structuredOutput?: unknown;
  providerMetadata?: Record<string, unknown>;
}

export type StreamResult = AsyncIterable<StreamEvent>;
