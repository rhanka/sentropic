/**
 * Faithful Anthropic Messages wire fixtures (spec §3b). Captured shapes (no real
 * network) for the v0 passthrough integration tests. The streamed event order
 * and `event:`/`data:` framing match the Anthropic Messages 2023-06-01 wire:
 *   message_start -> content_block_start -> content_block_delta* ->
 *   content_block_stop -> message_delta -> message_stop.
 *
 * These are the PROVIDER-NATIVE bytes the gateway must relay VERBATIM — the
 * fixture transport emits exactly these frames; the passthrough test asserts the
 * gateway response bytes equal them (faithful framing).
 */

/** A faithful non-stream Anthropic Messages response body. */
export const anthropicMessageResponse = {
  id: 'msg_01FixtureAbCdEf',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-4-6',
  content: [{ type: 'text', text: 'Hello from the pool.' }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 12, output_tokens: 15 },
} as const;

/**
 * The ordered Anthropic SSE events as `{ event, data }` pairs. The fixture
 * transport frames each with `event: <name>\ndata: <json>\n\n`.
 */
export const anthropicStreamEvents: ReadonlyArray<{ event: string; data: unknown }> = [
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_01FixtureAbCdEf',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 12, output_tokens: 1 },
      },
    },
  },
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  },
  {
    event: 'content_block_delta',
    data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
  },
  {
    event: 'content_block_delta',
    data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' from the pool.' } },
  },
  {
    event: 'content_block_stop',
    data: { type: 'content_block_stop', index: 0 },
  },
  {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 15 },
    },
  },
  {
    event: 'message_stop',
    data: { type: 'message_stop' },
  },
];

/** A mid-stream provider error event (Anthropic-native) for the no-retry test. */
export const anthropicErrorEvent = {
  event: 'error',
  data: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
} as const;

/** A faithful Anthropic Messages request body (passed through verbatim). */
export const anthropicRequest = (stream: boolean) => ({
  model: 'claude-sonnet-4-6',
  max_tokens: 256,
  messages: [{ role: 'user', content: 'Say hello.' }],
  ...(stream ? { stream: true } : {}),
});
