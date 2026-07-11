/**
 * Codex OAuth / ChatGPT-plan transport helpers.
 *
 * This is the reusable, package-owned seam remote must consume instead of
 * carrying its own gateway semantics. Codex OAuth tokens obtained through
 * `codex auth login` target ChatGPT's internal Codex Responses backend; they do
 * not have the public OpenAI API `model.request` scope.
 */

export const CODEX_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';

export type CodexReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';

export type CodexContentPart =
  | { type: 'text' | 'input_text'; text?: string }
  | { type: string; [key: string]: unknown };

export interface CodexInstructionsInputMessage {
  readonly role?: string;
  readonly content?: unknown;
}

export interface CodexResponsesRequestInput {
  readonly model: string;
  readonly stream?: boolean;
  readonly input?: unknown;
  readonly instructions?: string;
  readonly reasoning?: { readonly effort?: CodexReasoningEffort | string; readonly [key: string]: unknown };
  readonly max_output_tokens?: number;
  readonly store?: boolean;
  readonly [key: string]: unknown;
}

export interface CodexPreparedResponsesRequest {
  readonly url: typeof CODEX_RESPONSES_URL;
  readonly body: CodexResponsesRequestInput;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export const stringifyCodexContent = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value ?? '');
  } catch {
    return String(value ?? '');
  }
};

export const codexInstructionsText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return stringifyCodexContent(content);

  const text = content
    .map((part) => {
      if (!isRecord(part)) return '';
      const type = typeof part.type === 'string' ? part.type : '';
      if (type !== 'text' && type !== 'input_text') return '';
      return typeof part.text === 'string' ? part.text : '';
    })
    .filter((part) => part.trim().length > 0)
    .join('\n\n')
    .trim();

  return text || stringifyCodexContent(content);
};

export const collectCodexInstructions = (
  messages: readonly CodexInstructionsInputMessage[],
  fallback = 'You are a helpful assistant.',
): string => {
  const instructions = messages
    .filter((message) => message.role === 'system' || message.role === 'developer')
    .map((message) => codexInstructionsText(message.content))
    .filter((text) => text.trim().length > 0)
    .join('\n\n')
    .trim();

  return instructions || fallback;
};

const stripCodexInputIdsFromValue = (value: unknown): unknown => {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!isRecord(item) || !('id' in item)) return item;
    const { id: _id, ...rest } = item;
    return rest;
  });
};

export const stripCodexInputIds = (body: string): string => {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    parsed.input = stripCodexInputIdsFromValue(parsed.input);
    return JSON.stringify(parsed);
  } catch {
    return body;
  }
};

export const prepareCodexResponsesRequest = (
  request: CodexResponsesRequestInput,
): CodexPreparedResponsesRequest => {
  // Reasoning (including `xhigh`) is passed through unchanged to the Codex
  // backend — owner decision: no `xhigh`→`high` downgrade (WP16).
  const { max_output_tokens: _maxOutputTokens, ...rest } = request;
  return {
    url: CODEX_RESPONSES_URL,
    body: {
      ...rest,
      store: false,
    },
  };
};

export interface CodexUsageDoneEvent {
  readonly type: 'done';
  readonly data: { readonly usage?: unknown };
}

export const codexDoneEventFromResponseCompleted = (event: unknown): CodexUsageDoneEvent => {
  const record = isRecord(event) ? event : {};
  const response = isRecord(record.response) ? record.response : undefined;
  const usage = response && isRecord(response.usage) ? response.usage : undefined;
  return { type: 'done', data: usage ? { usage } : {} };
};
