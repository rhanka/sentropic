/**
 * A FIXTURE ProviderTransport — emits the captured native frames (no network).
 * It records the credential it received so tests can assert the pooled-cred
 * swap happened, and it can simulate a mid-stream provider failure (the
 * no-retry-after-stream test). The gateway relays its bytes verbatim.
 */

import type {
  GatewayDispatchResponse,
  GatewayDispatchStreamEvent,
} from '../../src/index.js';
import type {
  ProviderTransport,
  ProviderTransportRequest,
} from '../../src/index.js';
import {
  frameAnthropicEvent,
  frameOpenAiChunk,
} from '../../src/index.js';
import { anthropicErrorEvent, anthropicStreamEvents } from './anthropic.js';
import { openAiErrorChunk, openAiStreamChunks } from './openai.js';

export interface FixtureTransportOptions {
  /** Non-stream response to return from `send`. */
  readonly jsonResponse?: GatewayDispatchResponse;
  /** Pre-framed SSE frames to yield from `sendStream`. */
  readonly streamFrames?: readonly string[];
  /**
   * When set, throw AFTER yielding this many frames (mid-stream failure). E.g.
   * `failAfterFrames: 4` yields 4 frames (including a provider-native error
   * frame) then throws to simulate the dropped connection — the gateway has
   * already streamed bytes, so it settles failure WITHOUT retrying (spec §2).
   */
  readonly failAfterFrames?: number;
}

export class FixtureTransport implements ProviderTransport {
  /** Records every credential the gateway swapped in (for redaction/swap asserts). */
  readonly seenMaterials: ProviderTransportRequest['material'][] = [];
  readonly seenBodies: unknown[] = [];

  constructor(private readonly options: FixtureTransportOptions = {}) {}

  async send(request: ProviderTransportRequest): Promise<GatewayDispatchResponse> {
    this.seenMaterials.push(request.material);
    this.seenBodies.push(request.body);
    return (
      this.options.jsonResponse ?? { status: 200, body: { ok: true } }
    );
  }

  async *sendStream(
    request: ProviderTransportRequest,
  ): AsyncIterable<GatewayDispatchStreamEvent> {
    this.seenMaterials.push(request.material);
    this.seenBodies.push(request.body);
    const frames = this.options.streamFrames ?? [];
    let count = 0;
    for (const raw of frames) {
      yield { raw };
      count += 1;
      if (
        typeof this.options.failAfterFrames === 'number' &&
        count >= this.options.failAfterFrames
      ) {
        // Bytes already streamed -> throw to simulate the dropped connection.
        throw new Error('fixture: simulated mid-stream provider failure');
      }
    }
  }
}

/** Build the faithful Anthropic SSE frames from the fixture event list. */
export const anthropicFrames = (): string[] =>
  anthropicStreamEvents.map((e) => frameAnthropicEvent(e.event, e.data));

/** Build the faithful OpenAI SSE chunk frames (without the [DONE] terminator). */
export const openAiFrames = (): string[] =>
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
