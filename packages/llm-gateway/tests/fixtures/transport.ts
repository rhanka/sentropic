/**
 * A FIXTURE ProviderTransport — emits the captured native frames (no network).
 * It records the credential it received so tests can assert the pooled-cred
 * swap happened, and it can simulate a mid-stream provider failure (the
 * no-retry-after-stream test). The gateway relays its bytes verbatim.
 */

import type {
  GatewayDispatchResponse,
  GatewayDispatchStream,
  GatewayDispatchStreamEvent,
  ProviderResponseHeaders,
} from '../../src/index.js';
import type {
  ProviderTransport,
  ProviderTransportRequest,
} from '../../src/index.js';
import {
  OPENAI_DONE,
  frameAnthropicEvent,
  frameOpenAiChunk,
} from '../../src/index.js';
import { anthropicErrorEvent, anthropicStreamEvents } from './anthropic.js';
import { openAiErrorChunk, openAiStreamChunks } from './openai.js';

export interface FixtureTransportOptions {
  /** Non-stream response to return from `send`. */
  readonly jsonResponse?: GatewayDispatchResponse;
  /** Sequence of JSON responses — each call to `send` pops the next one. When exhausted, falls back to `jsonResponse`. */
  readonly jsonResponseSequence?: readonly GatewayDispatchResponse[];
  /** Pre-framed SSE frames to yield from `sendStream` (provider-native, incl. its own [DONE]). */
  readonly streamFrames?: readonly string[];
  /** Provider response headers returned by `send` / `sendStream` (#4 passthrough). */
  readonly responseHeaders?: ProviderResponseHeaders;
  /**
   * When set, throw AFTER yielding this many frames (mid-stream failure). E.g.
   * `failAfterFrames: 4` yields 4 frames (including a provider-native error
   * frame) then throws to simulate the dropped connection — the gateway has
   * already streamed bytes, so it settles failure WITHOUT retrying (spec §2).
   */
  readonly failAfterFrames?: number;
  /** Throw from `sendStream` BEFORE yielding any frame (pre-first-byte failure, #6). */
  readonly failBeforeFirstFrame?: boolean;
}

export class FixtureTransport implements ProviderTransport {
  /** Records every credential the gateway swapped in (for redaction/swap asserts). */
  readonly seenMaterials: ProviderTransportRequest['material'][] = [];
  readonly seenBodies: unknown[] = [];
  private jsonCallIndex = 0;

  constructor(private readonly options: FixtureTransportOptions = {}) {}

  async send(request: ProviderTransportRequest): Promise<GatewayDispatchResponse> {
    this.seenMaterials.push(request.material);
    this.seenBodies.push(request.body);
    const sequence = this.options.jsonResponseSequence;
    if (sequence && this.jsonCallIndex < sequence.length) {
      const resp = sequence[this.jsonCallIndex];
      this.jsonCallIndex++;
      return this.options.responseHeaders
        ? { ...resp, headers: this.options.responseHeaders }
        : resp;
    }
    const base = this.options.jsonResponse ?? { status: 200, body: { ok: true } };
    return this.options.responseHeaders
      ? { ...base, headers: this.options.responseHeaders }
      : base;
  }

  sendStream(request: ProviderTransportRequest): GatewayDispatchStream {
    this.seenMaterials.push(request.material);
    this.seenBodies.push(request.body);
    const options = this.options;
    const frames = (async function* (): AsyncGenerator<GatewayDispatchStreamEvent> {
      if (options.failBeforeFirstFrame) {
        // Pre-first-byte provider failure (#6): no frame ever streams.
        throw new Error('fixture: simulated pre-first-byte provider failure');
      }
      const list = options.streamFrames ?? [];
      let count = 0;
      for (const raw of list) {
        yield { raw };
        count += 1;
        if (typeof options.failAfterFrames === 'number' && count >= options.failAfterFrames) {
          // Bytes already streamed -> throw to simulate the dropped connection.
          throw new Error('fixture: simulated mid-stream provider failure');
        }
      }
    })();
    return {
      ...(options.responseHeaders ? { headers: options.responseHeaders } : {}),
      frames,
    };
  }
}

/** Build the faithful Anthropic SSE frames from the fixture event list (no [DONE], message_stop terminates). */
export const anthropicFrames = (): string[] =>
  anthropicStreamEvents.map((e) => frameAnthropicEvent(e.event, e.data));

/**
 * Build the faithful OpenAI SSE chunk frames INCLUDING the provider's own
 * `data: [DONE]` terminator — a real OpenAI transport emits it; the gateway
 * relays it verbatim and synthesizes none of its own (B3).
 */
export const openAiFrames = (): string[] => [
  ...openAiStreamChunks.map((c) => frameOpenAiChunk(c)),
  OPENAI_DONE,
];

/** OpenAI chunk frames WITHOUT a terminator (for asserting the gateway adds none). */
export const openAiFramesNoDone = (): string[] =>
  openAiStreamChunks.map((c) => frameOpenAiChunk(c));

/** A faithful Anthropic stream including a mid-stream native error event. */
export const anthropicFramesWithError = (): string[] => [
  ...anthropicStreamEvents
    .slice(0, 3)
    .map((e) => frameAnthropicEvent(e.event, e.data)),
  frameAnthropicEvent(anthropicErrorEvent.event, anthropicErrorEvent.data),
];

/** A faithful OpenAI stream including a mid-stream native error chunk. */
export const openAiFramesWithError = (): string[] => [
  ...openAiStreamChunks.slice(0, 2).map((c) => frameOpenAiChunk(c)),
  frameOpenAiChunk(openAiErrorChunk),
];
