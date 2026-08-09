import { describe, expect, it, vi } from 'vitest';
import { CloudCodeRuntimeClient } from '../../src/transport/cloud-code-runtime-client.js';

const context = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'cloud-code' as const,
      accessToken: 'secret-cloud-token', accountId: 'cloud-account-1',
      metadata: {
        stableSessionId: 'stable-session-1', leaseId: 'lease-1',
        cloudaicompanionProject: 'project-1',
      },
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'cloud-code' as const },
  },
};

const streamResponse = () => new Response(new ReadableStream<Uint8Array>({
  start(controller) {
    const payload = {
      response: {
        candidates: [{ content: { parts: [
          { text: 'thinking', thought: true },
          { text: 'answer' },
          { functionCall: { id: 'call-1', name: 'lookup', args: { id: 1 } } },
        ] } }],
        usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4, totalTokenCount: 13 },
      },
    };
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`));
    controller.close();
  },
}), { status: 200, headers: { 'content-type': 'text/event-stream' } });

describe('Cloud Code runtime client', () => {
  it('preserves canonical system, image, tool and response events', async () => {
    const fetchFn = vi.fn(async () => streamResponse());
    const client = new CloudCodeRuntimeClient(fetchFn);

    const response = await client.generate({
      providerId: 'gemini', modelId: 'gemini-3.5-flash',
      messages: [
        { role: 'system', content: 'System' },
        { role: 'user', content: [
          { type: 'text', text: 'Inspect' },
          { type: 'image', mediaType: 'image/png', data: 'AA==' },
        ] },
      ],
      tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object' } }],
      reasoning: { effort: 'high' },
    }, context);

    expect(response).toMatchObject({
      providerId: 'gemini', modelId: 'gemini-3.5-flash', text: 'answer',
      finishReason: 'tool_calls',
      toolCalls: [{
        providerCallId: 'call-1', name: 'lookup', arguments: { id: 1 },
      }],
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
    });
    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-cloud-token' });
    expect(JSON.parse(String(init.body))).toMatchObject({
      project: 'project-1', model: 'gemini-3.5-flash',
      request: {
        systemInstruction: { parts: [{ text: 'System' }] },
        contents: [{ role: 'user', parts: [
          { text: 'Inspect' },
          { inlineData: { mimeType: 'image/png', data: 'AA==' } },
        ] }],
        tools: [{ functionDeclarations: [{ name: 'lookup', parameters: { type: 'object' } }] }],
        generationConfig: { thinkingConfig: { effort: 'high' } },
      },
    });
  });

  it('surfaces Retry-After on a canonical error event', async () => {
    const client = new CloudCodeRuntimeClient(async () => new Response('rate limited', {
      status: 429, headers: { 'retry-after': '6' },
    }));
    const events = [];
    for await (const event of await client.stream({
      providerId: 'gemini', modelId: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'hello' }],
    }, context)) events.push(event);

    expect(events).toEqual([{ type: 'error', data: expect.objectContaining({
      providerId: 'gemini', code: 'rate_limited', statusCode: 429,
      retryAfterMs: 6_000, retryable: true,
    }) }]);
  });

  it('projects Claude tool schemas onto the Cloud Code supported subset', async () => {
    const fetchFn = vi.fn(async () => streamResponse());
    const client = new CloudCodeRuntimeClient(fetchFn);

    await client.generate({
      providerId: 'gemini', modelId: 'gemini-3.1-flash-lite',
      messages: [{ role: 'user', content: 'hello' }],
      tools: [{
        type: 'function', name: 'agent', inputSchema: {
          $schema: 'https://json-schema.org/draft/2020-12/schema',
          type: ['object', 'null'], additionalProperties: false,
          properties: {
            prompt: { type: 'string', minLength: 1 },
            limit: { type: 'integer', exclusiveMinimum: 0, const: 1 },
            mode: { oneOf: [
              { const: 'fast' },
              { type: 'string', pattern: '^[a-z]+$' },
            ] },
            mixed: { enum: ['fast', 2] },
          },
          required: ['prompt'],
        },
      }],
    }, context);

    const [, init] = fetchFn.mock.calls[0]!;
    const body = JSON.parse(String(init.body));
    expect(body.request.tools[0].functionDeclarations[0].parameters).toEqual({
      type: 'object', nullable: true,
      properties: {
        prompt: { type: 'string' },
        limit: { type: 'integer' },
        mode: { anyOf: [{ enum: ['fast'] }, { type: 'string' }] },
        mixed: {},
      },
      required: ['prompt'],
    });
    expect(JSON.stringify(body)).not.toContain('$schema');
    expect(JSON.stringify(body)).not.toContain('additionalProperties');
    expect(JSON.stringify(body)).not.toContain('exclusiveMinimum');
  });
});
