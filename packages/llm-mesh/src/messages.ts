import type { ToolCall, ToolResult } from './tools.js';

export type MessageRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool';

export interface TextContentPart {
  type: 'text';
  text: string;
}

export interface ImageContentPart {
  type: 'image';
  mediaType?: string;
  data?: string;
  url?: string;
}

export interface FileContentPart {
  type: 'file';
  mediaType?: string;
  data?: string;
  url?: string;
  filename?: string;
}

/** Provider-originated reasoning history that may carry a replay signature. */
export interface ReasoningContentPart {
  type: 'reasoning';
  text: string;
  signature?: string;
  redacted?: boolean;
}

export type MessageContent = string | readonly (
  TextContentPart | ImageContentPart | FileContentPart | ReasoningContentPart
)[];

export interface BaseMessage {
  role: MessageRole;
  content: MessageContent;
  name?: string;
  metadata?: Record<string, unknown>;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  toolCalls?: readonly ToolCall[];
}

export interface ToolMessage extends BaseMessage {
  role: 'tool';
  toolResult: ToolResult;
}

export type LlmMeshMessage =
  | (BaseMessage & { role: 'system' | 'developer' | 'user' })
  | AssistantMessage
  | ToolMessage;
