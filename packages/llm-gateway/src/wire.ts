/**
 * Wire helpers (spec §3b). The gateway resolves provider/model from the request
 * BODY `model` (the only body field it reads for routing) and frames responses
 * faithfully per wire:
 *   - Anthropic Messages: `event: <name>\ndata: <json>\n\n` ... `message_stop`.
 *   - OpenAI Chat Completions: `data: <json>\n\n` ... `data: [DONE]\n\n`.
 *
 * The gateway does NOT mutate the provider-native body or the provider-native
 * SSE payloads — it only frames/relays them. These helpers exist so the router
 * can (a) read `model` for routing and (b) re-frame a normalized event stream
 * into the faithful provider SSE bytes for a fixture/passthrough test.
 */

import type { GatewayWire } from './ports/dispatch.js';

export const WIRE_BY_PATH: Readonly<Record<string, GatewayWire>> = {
  '/v1/messages': 'anthropic-messages',
  '/v1/chat/completions': 'openai-chat-completions',
};

/**
 * Read the `model` string from a provider-native request body. Both Anthropic
 * Messages and OpenAI Chat Completions place the model at top-level `model`.
 * Returns `undefined` for a malformed body (router maps to a 400 bad-request).
 */
export const readModel = (body: unknown): string | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  const model = (body as { model?: unknown }).model;
  return typeof model === 'string' && model.length > 0 ? model : undefined;
};

/** Read the `stream` flag from a provider-native body (defaults false). */
export const readStream = (body: unknown): boolean => {
  if (!body || typeof body !== 'object') {
    return false;
  }
  return (body as { stream?: unknown }).stream === true;
};

/**
 * Frame one Anthropic Messages SSE event: `event: <name>\ndata: <json>\n\n`.
 * `data` is the provider-native JSON, passed through verbatim.
 */
export const frameAnthropicEvent = (eventName: string, data: unknown): string =>
  `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;

/** Frame one OpenAI Chat Completions SSE chunk: `data: <json>\n\n`. */
export const frameOpenAiChunk = (data: unknown): string =>
  `data: ${JSON.stringify(data)}\n\n`;

/** The OpenAI stream terminator. */
export const OPENAI_DONE = 'data: [DONE]\n\n';

/** Content-Type for an SSE response. */
export const SSE_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

/**
 * Parse a raw SSE text blob into discrete events for assertions. Splits on the
 * blank-line record separator and keeps the raw frame. Used by tests to assert
 * faithful framing without re-implementing an SSE parser in each test.
 */
export interface ParsedSseEvent {
  readonly event?: string;
  readonly data: string;
  readonly raw: string;
}

export const parseSse = (text: string): ParsedSseEvent[] => {
  const events: ParsedSseEvent[] = [];
  for (const block of text.split('\n\n')) {
    const trimmed = block.replace(/\n+$/, '');
    if (trimmed.length === 0) {
      continue;
    }
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }
    events.push({
      ...(event ? { event } : {}),
      data: dataLines.join('\n'),
      raw: `${trimmed}\n\n`,
    });
  }
  return events;
};
