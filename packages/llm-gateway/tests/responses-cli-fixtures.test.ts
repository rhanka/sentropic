/**
 * Fixture replay (spec §16.9): every captured Muse/Codex body passes
 * through the real router, planner and codecs with fake provider I/O, and
 * the synthetic provider SSE fixtures drive the native Codex and
 * translated Chat clients independently. No network, no database.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GenerateRequest, PreparedRouteAttempt, RoutePlanner } from '@sentropic/llm-mesh';
import {
  CodexRuntimeClient,
  MistralRuntimeClient,
  MuseRuntimeClient,
} from '@sentropic/llm-mesh';

import {
  createGatewayRouter,
  PersonalPassthroughCallerAuth,
  stubGatewayConfig,
  VerifiedCostContextResolver,
} from '../src/index.js';

const load = async (name: string): Promise<any> => {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(new URL(`./fixtures/responses/${name}`, import.meta.url), 'utf8'));
};

const loadText = async (name: string): Promise<string> => {
  const { readFile } = await import('node:fs/promises');
  return readFile(new URL(`./fixtures/responses/${name}`, import.meta.url), 'utf8');
};

const rig = () => {
  const verify = vi.fn(() => ({ tenantId: 't', principalId: 'p', source: 'test', ownerScopeRef: 'enrolled:p' }));
  const captured: GenerateRequest[] = [];
  const settleRoute = vi.fn();
  const plan = vi.fn(async (_subject: unknown, input: { requestedModel: string }) => ({
    planRef: 'p', candidateRefs: ['c'], diagnostics: [{
      candidateRef: 'c',
      actualProviderId: String(input.requestedModel).startsWith('muse') ? 'muse' : 'openai',
      actualModelId: input.requestedModel, actualTransportProviderId: 'test',
    }],
  }));
  const attempt = {
    attemptRef: 'opaque',
    async generate(request: GenerateRequest) {
      captured.push(request);
      const tools = (request.tools ?? []).slice(0, 1).map((tool) => ({
        toolCallId: `call_${tool.name}`, providerCallId: `call_${tool.name}`, name: tool.name, argumentsText: '{}',
      }));
      // Canonical ingress carries the model on `model`, not `modelId`.
      const servedModel = typeof request.model === 'string' ? request.model : request.modelId;
      return { id: 'resp_replay', providerId: 'openai', modelId: servedModel,
        message: { role: 'assistant', content: 'canned' }, text: 'canned', toolCalls: tools,
        finishReason: tools.length > 0 ? 'tool_calls' : 'stop',
        usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 } };
    },
    async markCommitted() {}, async complete() {}, async releaseCancelled() {}, async recordOutcome() {},
  } as unknown as PreparedRouteAttempt;
  const app = createGatewayRouter({ config: { ...stubGatewayConfig,
    callerAuth: new PersonalPassthroughCallerAuth({ verifyToken: { verify }, costContextResolver: new VerifiedCostContextResolver() }),
  }, routePlanner: { plan, prepareAttempt: async () => attempt } as unknown as RoutePlanner,
  routeMetering: { settleRoute }, requestId: () => 'replay-request' });
  // All committed fixtures set `stream: true` (live CLI default); the JSON
  // replay pins the non-streaming route, so it replays with streaming off.
  // SSE framing is covered by the stream encoder and flow tests.
  const send = (path: string, body: Record<string, unknown>) => app.request(path, { method: 'POST',
    headers: { 'x-api-key': 'trusted-token', 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, stream: false }) });
  return { send, captured, settleRoute };
};

describe('fixture replay through the real route (spec §16.9)', () => {
  it.each([
    ['muse-1.4.6-initial-a.json', '/responses', 'muse-spark-1.3-contributor', 26],
    ['muse-1.4.6-initial-b.json', '/responses', 'muse-spark-1.3-contributor', 1],
    ['codex-0.162.1-initial.json', '/v1/responses', 'gpt-6.1-sol', 10],
    ['codex-0.162.1-tools.json', '/v1/responses', 'gpt-6.1-sol', 10],
  ] as const)('replays %s without losing model, tools or usage', async (file, path, model, toolCount) => {
    const f = rig();
    const res = await f.send(path, await load(file));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, any>;
    expect(body).toMatchObject({ object: 'response', model, status: 'completed', store: false });
    expect(body.output?.some((item: any) => item.type === 'function_call')).toBe(true);
    expect(f.captured).toHaveLength(1);
    const attempted = f.captured[0]!;
    expect(typeof attempted.model === 'string' ? attempted.model : attempted.modelId).toBe(model);
    expect(f.captured[0]!.tools?.map((tool) => tool.name)).toHaveLength(toolCount);
    expect(body.usage).toMatchObject({ input_tokens: 10, output_tokens: 3, total_tokens: 13 });
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });

  it.each([
    ['muse-1.4.6-tool-result.json', '/responses'],
    ['codex-0.162.1-tool-result.json', '/v1/responses'],
  ] as const)('replays %s with call_id correlation intact', async (file, path) => {
    const f = rig();
    const res = await f.send(path, await load(file));
    expect(res.status).toBe(200);
    const tools = f.captured[0]!.messages.filter((message) => message.role === 'tool');
    expect(tools.length).toBeGreaterThan(0);
    const callIds = tools.flatMap((message) => message.role === 'tool' ? [message.toolResult.providerCallId] : []);
    expect(callIds).toContain('call_rec1');
    expect(f.settleRoute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: 'success' }));
  });
});

describe('synthetic provider replay per transport (spec §16.4)', () => {
  const accountAuth = (provider: 'codex' | 'muse' | 'mistral') => ({ auth: { material: {
    type: 'account-transport' as const, provider, accessToken: 'secret', accountId: 'acct_1',
    metadata: { stableSessionId: 'stable-1' } },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: provider } } });
  const sse = async (name: string) => new Response(await loadText(name),
    { status: 200, headers: { 'content-type': 'text/event-stream' } });

  it('drives native Codex from synthetic SSE without losing calls or usage', async () => {
    const client = new CodexRuntimeClient({ fetch: async () => sse('provider-codex.sse') });
    const response = await client.generate({ providerId: 'openai', modelId: 'gpt-6.1-sol',
      messages: [{ role: 'user', content: 'hi' }] }, accountAuth('codex'));
    expect(response).toMatchObject({ text: 'Synthetic ok', finishReason: 'tool_calls',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
    expect(response.toolCalls).toEqual([{ toolCallId: 'fc_synth_1', providerCallId: 'call_synth_1',
      name: 'get_time', argumentsText: '{"x":1}' }]);
  });

  it.each([
    ['provider-muse-chat.sse', MuseRuntimeClient, 'muse', 'muse-spark-1.3-contributor', 'call_synth_9'],
    ['provider-mistral-chat.sse', MistralRuntimeClient, 'mistral', 'mistral-medium-3.5', 'call_synth_7'],
  ] as const)('drives translated Chat from %s', async (file, Client, provider, modelId, callId) => {
    // Chat `generate` serves the non-stream JSON shape; the SSE wire is
    // consumed by `stream`, so the replay folds its events directly.
    const client = new Client({ fetch: async () => sse(file) });
    const stream = await client.stream({ providerId: provider, modelId,
      messages: [{ role: 'user', content: 'hi' }] }, accountAuth(provider));
    let text = ''; let start: Record<string, unknown> | undefined;
    const fragments: string[] = []; let done: Record<string, unknown> | undefined;
    for await (const event of stream) {
      if (event.type === 'content_delta') text += String(event.data.delta ?? '');
      else if (event.type === 'tool_call_start') start = event.data as unknown as Record<string, unknown>;
      else if (event.type === 'tool_call_delta') fragments.push(String(event.data.delta ?? ''));
      else if (event.type === 'done') done = event.data as Record<string, unknown>;
    }
    expect(text).toBe('Synthetic ok');
    expect(start).toMatchObject({ toolCallId: callId, providerCallId: callId, name: 'get_time' });
    expect(fragments.join('')).toBe('{"x":1}');
    expect(done).toMatchObject({ finishReason: 'tool_calls',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });
  });
});
