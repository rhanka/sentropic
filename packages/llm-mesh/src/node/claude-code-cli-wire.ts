// @sentropic/llm-mesh/node/claude-code-cli-wire.ts
//
// Pure stream-json wire for the `claude` CLI host: deterministic prompt
// rendering, quota prose diagnosis, and line normalization to
// ClaudeCodeCliEvent outcomes. No process, clock, or network access —
// safe to unit-test without a CLI.

import type {
  ClaudeCodeCliEvent,
  ClaudeCodeCliRequest,
} from '../transport/claude-code-runtime-client.js';

/** Deterministic prompt rendering; pinned by unit tests with a fake CLI. */
export const renderClaudeCodeCliPrompt = (request: ClaudeCodeCliRequest): string => {
  const lines: string[] = [];
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === 'text') {
        lines.push(`${message.role}: ${part.text}`);
      } else if (part.type === 'tool_use') {
        lines.push(`${message.role} tool_use ${part.name} ${part.id}: ${JSON.stringify(part.input)}`);
      } else {
        lines.push(`${message.role} tool_result ${part.tool_use_id}: ${part.content}`);
      }
    }
    if (message.content.length === 0) lines.push(`${message.role}:`);
  }
  return `${lines.join('\n')}\n`;
};

export interface QuotaDiagnosis {
  readonly quota: boolean;
  readonly retryAfterMs?: number;
}

const QUOTA_PATTERN = /5-hour|usage.?limit|rate.?limit|too many requests|\b429\b|quota|overloaded/i;
const STRUCTURED_QUOTA_KEYS = ['result', 'message', 'error'] as const;
const RETRY_AFTER_PATTERN = /(\d+)\s*(milliseconds?|seconds?|minutes?|hours?)/i;

const readRetryAfterMs = (text: string): number | undefined => {
  const match = RETRY_AFTER_PATTERN.exec(text);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2]!.toLowerCase();
  if (!Number.isSafeInteger(amount) || amount < 0) return undefined;
  const factor = unit.startsWith('millis') ? 1 : unit.startsWith('s') ? 1_000
    : unit.startsWith('m') ? 60_000 : 3_600_000;
  const ms = amount * factor;
  return Number.isSafeInteger(ms) ? ms : undefined;
};

/**
 * Quota-relevant text out of a CLI error payload: CLI-owned message fields
 * only (`result`, `message`, `error`, string or numeric `code`). Numeric
 * telemetry beside them (token usage, costs) is never signal, so a bare
 * `429` buried in `usage` cannot trip the quota circuit.
 */
export const extractQuotaText = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) return undefined;
  const parts: string[] = [];
  for (const key of STRUCTURED_QUOTA_KEYS) {
    const value = payload[key];
    if (typeof value === 'string' && value.length > 0) parts.push(value);
  }
  const code: unknown = payload['code'];
  if (typeof code === 'string' && code.length > 0) parts.push(code);
  else if (typeof code === 'number' && Number.isSafeInteger(code)) parts.push(String(code));
  return parts.length > 0 ? parts.join(' ') : undefined;
};

/**
 * Append a chunk to a byte-capped stderr tail. A non-positive cap keeps
 * nothing (the caller still drains the pipe, but stores no bytes).
 */
export const appendCappedTail = (current: Buffer, chunk: Uint8Array, capBytes: number): Buffer => {
  if (capBytes <= 0) return Buffer.from('');
  const next = Buffer.concat([current, Buffer.from(chunk)]);
  return next.length <= capBytes ? next : Buffer.from(next.subarray(next.length - capBytes));
};

/** Match quota prose in CLI-owned text only (stderr, error payloads). */
export const diagnoseClaudeCodeQuota = (text: unknown): QuotaDiagnosis => {
  if (typeof text !== 'string' || text.length === 0) return { quota: false };
  if (!QUOTA_PATTERN.test(text)) return { quota: false };
  const retryAfterMs = readRetryAfterMs(text);
  return retryAfterMs === undefined ? { quota: true } : { quota: true, retryAfterMs };
};

export type ClaudeCodeLineOutcome =
  | { type: 'system_init'; init: { tools?: unknown; mcpServers?: unknown } }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; event: Extract<ClaudeCodeCliEvent, { type: 'tool_use' }> }
  | { type: 'stop_reason'; reason: unknown }
  | { type: 'result'; result: { finishReason: 'stop' | 'length' | 'tool_calls';
      usage?: { inputTokens?: number; outputTokens?: number }; resultText?: string } }
  | { type: 'error_payload'; payload: unknown };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const safeInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

/** Normalize one stream-json line; unknown and noise lines yield nothing. */
export const parseClaudeCodeLine = (line: string): ClaudeCodeLineOutcome[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return [];
  if (parsed.type === 'system' && parsed.subtype === 'init') {
    const init: { tools?: unknown; mcpServers?: unknown } = {};
    if ('tools' in parsed) init.tools = parsed['tools'];
    if ('mcp_servers' in parsed) init.mcpServers = parsed['mcp_servers'];
    else if ('mcpServers' in parsed) init.mcpServers = parsed['mcpServers'];
    return [{ type: 'system_init', init }];
  }
  if (parsed.type === 'assistant') {
    const message = parsed.message;
    if (!isRecord(message) || !Array.isArray(message.content)) return [];
    const outcomes: ClaudeCodeLineOutcome[] = [];
    for (const block of message.content) {
      if (!isRecord(block) || typeof block.type !== 'string') continue;
      if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        outcomes.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use' && typeof block.id === 'string'
        && typeof block.name === 'string' && isRecord(block.input)) {
        outcomes.push({ type: 'tool_use',
          event: { type: 'tool_use', id: block.id, name: block.name, input: block.input } });
      }
    }
    if (message.stop_reason !== undefined) {
      outcomes.push({ type: 'stop_reason', reason: message.stop_reason });
    }
    return outcomes;
  }
  if (parsed.type === 'result') {
    if (parsed.subtype === 'success' && parsed.is_error !== true) {
      const usage = isRecord(parsed.usage) ? {
        ...(safeInt(parsed.usage.input_tokens) !== undefined ? { inputTokens: safeInt(parsed.usage.input_tokens)! } : {}),
        ...(safeInt(parsed.usage.output_tokens) !== undefined ? { outputTokens: safeInt(parsed.usage.output_tokens)! } : {}),
      } : undefined;
      const resultText = typeof parsed.result === 'string' ? parsed.result : undefined;
      return [{ type: 'result', result: { finishReason: 'stop',
        ...(usage && Object.keys(usage).length ? { usage } : {}),
        ...(resultText !== undefined ? { resultText } : {}) } }];
    }
    return [{ type: 'error_payload', payload: parsed }];
  }
  return [];
};
