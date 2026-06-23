/**
 * Faithful OpenAI Chat Completions wire fixtures (spec §3b). Captured shapes
 * (no real network). Streamed chunks are `data: <json>\n\n`, terminated by the
 * literal `data: [DONE]\n\n`. The first delta carries `role`, middle deltas
 * carry `content`, the final content-bearing chunk has `finish_reason: "stop"`
 * with an empty delta.
 *
 * These are the PROVIDER-NATIVE bytes the gateway relays VERBATIM.
 */

/** A faithful non-stream OpenAI Chat Completions response body. */
export const openAiChatResponse = {
  id: 'chatcmpl-Fixture123',
  object: 'chat.completion',
  created: 1718900000,
  model: 'gpt-5.5',
  choices: [
    {
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content: 'Hello from the pool.', refusal: null },
      logprobs: null,
    },
  ],
  usage: { prompt_tokens: 12, completion_tokens: 15, total_tokens: 27 },
} as const;

/**
 * The ordered OpenAI stream chunks (each framed `data: <json>\n\n`). The stream
 * is terminated with the literal `data: [DONE]\n\n` by the gateway.
 */
export const openAiStreamChunks: ReadonlyArray<unknown> = [
  {
    id: 'chatcmpl-Fixture123',
    object: 'chat.completion.chunk',
    created: 1718900000,
    model: 'gpt-5.5',
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  },
  {
    id: 'chatcmpl-Fixture123',
    object: 'chat.completion.chunk',
    created: 1718900000,
    model: 'gpt-5.5',
    choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
  },
  {
    id: 'chatcmpl-Fixture123',
    object: 'chat.completion.chunk',
    created: 1718900000,
    model: 'gpt-5.5',
    choices: [{ index: 0, delta: { content: ' from the pool.' }, finish_reason: null }],
  },
  {
    id: 'chatcmpl-Fixture123',
    object: 'chat.completion.chunk',
    created: 1718900000,
    model: 'gpt-5.5',
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 15, total_tokens: 27 },
  },
];

/** A mid-stream OpenAI-native error chunk for the no-retry test. */
export const openAiErrorChunk = {
  error: { message: 'The server is overloaded.', type: 'server_error', code: 'overloaded' },
} as const;

/** A faithful OpenAI Chat Completions request body (passed through verbatim). */
export const openAiRequest = (stream: boolean) => ({
  model: 'gpt-5.5',
  messages: [{ role: 'user', content: 'Say hello.' }],
  ...(stream ? { stream: true } : {}),
});
