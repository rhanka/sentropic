import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviderAdapters } from '../../src/adapters.js';
import type { AuthInput, SecretAuthMaterial } from '../../src/auth.js';
import type { StreamRequest } from '../../src/generation.js';
import { ClaudeCodeRuntimeClient, type ClaudeCodeCliCapabilities,
  type ClaudeCodeCliEvent, type ClaudeCodeCliRunner } from '../../src/index.js';

const now = Date.parse('2026-09-26T12:00:00Z');
const scopes = ['user:profile', 'user:inference', 'user:sessions:claude_code'];
const credential = () => ({ type: 'account-transport' as const, provider: 'claude-code',
  accessToken: 'fake-access-canary', refreshToken: 'fake-refresh-canary',
  expiresAt: new Date(now + 60_000).toISOString(),
  headers: { authorization: 'fake-header-canary' }, metadata: { scopes, extra: 'private-canary' } });
const request = (): StreamRequest => ({ modelId: 'claude-sonnet-4-6',
  messages: [{ role: 'user', content: 'Hello' }] });
const capabilities: ClaudeCodeCliCapabilities = { protocol: 'claude-code-stream-json-v1',
  cliVersion: 'fake-test-version', source: 'fake-source-fixture', qualificationRef: 'fake-M3-M5-receipt' };
const success: ClaudeCodeCliEvent[] = [{ type: 'text_delta', text: 'Hi' },
  { type: 'result', finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2 } }];
const fixture = (events = success, caps = capabilities) => {
  const run = vi.fn<ClaudeCodeCliRunner['run']>(() => (async function* () { yield* events; })());
  return { run, client: new ClaudeCodeRuntimeClient({ runner: { run }, capabilities: caps, now: () => now }) };
};
const collect = async (source: AsyncIterable<unknown>) => {
  const events: unknown[] = []; for await (const event of source) events.push(event); return events;
};

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); })));
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('Claude CLI capability boundary', () => {
  const tool = { type: 'function' as const, name: 'lookup', inputSchema: { type: 'object' } };
  it.each([
    { temperature: 0 }, { topP: 1 }, { maxOutputTokens: 10 }, { reasoning: {} },
    { providerOptions: {} }, { previousResponseId: 'fake-continuation' }, { parallelToolCalls: false },
    { responseFormat: { type: 'json-object' } }, { toolChoice: 'required' }, { toolChoice: 'none' },
    { toolChoice: { type: 'tool', name: 'lookup' } }, { tools: [tool] },
    { providerId: 'openai' }, { model: 'anthropic/claude-sonnet-4-6' }, { modelId: '--bad' },
    { modelId: undefined }, { messages: [] }, { messages: [{ role: 'system', content: 'private' }] },
    { messages: [{ role: 'developer', content: 'private' }] },
    { messages: [{ role: 'user', content: [{ type: 'image', url: 'https://example.invalid' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'file', data: 'fake' }] }] },
    { messages: [{ role: 'user', content: [{ type: 'reasoning', text: 'fake' }] }] },
    { messages: [...request().messages, { role: 'assistant', content: 'prior' }] },
  ])('should refuse unsupported request %j before any runner call', async (patch) => {
    const { client, run } = fixture();
    await expect(client.generate({ ...request(), ...patch } as StreamRequest, { auth: credential() }))
      .rejects.toMatchObject({ code: 'claude_cli_unsupported' });
    expect(run).not.toHaveBeenCalled();
  });

  it.each([{ protocol: 'other' }, { cliVersion: '' }, { source: '' }, { qualificationRef: '' }])(
    'should refuse incomplete host qualification %j', async (patch) => {
      const { client, run } = fixture(success, { ...capabilities, ...patch } as ClaudeCodeCliCapabilities);
      await expect(client.generate(request(), { auth: credential() })).rejects.toMatchObject({ code: 'claude_cli_unsupported' });
      expect(run).not.toHaveBeenCalled();
    });

  it('should map qualified text parts, tool calls and a subsequent tool result without auth/metadata', async () => {
    const caps = { ...capabilities, tools: 'fake-tool-source-and-receipt', history: 'fake-history-source-and-receipt' };
    const { client, run } = fixture([{ type: 'text_delta', text: 'Looking' },
      { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: 'test' } },
      { type: 'result', finishReason: 'tool_calls', usage: { inputTokens: 8, outputTokens: 4 } }], caps);
    const input = { ...request(), tools: [tool], messages: [{ role: 'user' as const,
      content: [{ type: 'text' as const, text: 'Look up' }, { type: 'text' as const, text: ' test' }] }] };
    const first = await client.generate(input, { auth: credential() });
    expect(first.toolCalls).toEqual([{ toolCallId: 'call-1', providerCallId: 'call-1', name: 'lookup',
      arguments: { q: 'test' }, argumentsText: '{"q":"test"}', inputState: 'complete' }]);
    expect(first.finishReason).toBe('tool_calls');
    const second = fixture(success, caps);
    await second.client.generate({ ...input, messages: [...input.messages, first.message,
      { role: 'tool', content: '', toolResult: { toolCallId: 'call-1', output: 'found', isError: false } }] },
    { auth: credential() });
    expect(second.run.mock.calls[0][0].request.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Look up' }, { type: 'text', text: ' test' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Looking' },
        { type: 'tool_use', id: 'call-1', name: 'lookup', input: { q: 'test' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: 'found', is_error: false }] },
    ]);
    expect(run.mock.calls[0][0].request.tools).toEqual([{ name: 'lookup', inputSchema: { type: 'object' } }]);
    const streaming = fixture(success);
    expect(await collect(await streaming.client.stream(request(), { auth: credential() }))).toEqual([
      { type: 'content_delta', data: { delta: 'Hi' } },
      { type: 'done', data: { finishReason: 'stop', providerId: 'anthropic', modelId: request().modelId,
        usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } } },
    ]);
  });
});

describe('Claude CLI access and routing', () => {
  it('should project only access, expiry and actual grant scopes through the Anthropic adapter', async () => {
    const { client, run } = fixture();
    const adapter = createDefaultProviderAdapters({ anthropic: client }).find((a) => a.provider.providerId === 'anthropic')!;
    const auth = credential();
    const response = await adapter.generate({ ...request(), auth }, { auth });
    expect(response).toMatchObject({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6', text: 'Hi',
      finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } });
    expect(run).toHaveBeenCalledOnce();
    const input = run.mock.calls[0][0];
    expect(Object.keys(input).sort()).toEqual(['access', 'request', 'signal']);
    expect(input.access).toEqual({ accessToken: auth.accessToken, expiresAt: now + 60_000, scopes });
    expect(input.access.scopes).not.toBe(scopes);
    expect(input.request).toEqual({ modelId: request().modelId,
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] });
    expect(JSON.stringify(input)).not.toMatch(/fake-refresh|fake-header|private-canary/);
  });

  it.each(['material', 'resolution'])('should accept access-only custody scopes from the %s descriptor', async (place) => {
    const { client, run } = fixture();
    const descriptor = { sourceType: 'claude-code-account' as const, metadata: { scopes } };
    const material = { type: 'claude-code-account' as const, provider: 'claude-code' as const,
      accessToken: 'fake-custody', expiresAt: credential().expiresAt };
    const auth: AuthInput = place === 'material' ? { ...material, descriptor } : { material, descriptor };
    await client.generate(request(), { auth });
    expect(run.mock.calls[0][0].access).toEqual({ accessToken: 'fake-custody', expiresAt: now + 60_000, scopes });
  });

  const others: SecretAuthMaterial[] = [
    { type: 'direct-token', token: 'fake-key' }, { type: 'user-token', userId: 'u', token: 'fake' },
    { type: 'workspace-token', workspaceId: 'w', token: 'fake' },
    { type: 'environment-token', envVar: 'TEST_KEY', token: 'fake' }, { type: 'none' },
    { type: 'codex-account', provider: 'codex', accessToken: 'fake' },
    { type: 'account-transport', provider: 'muse', accessToken: 'fake' },
  ];
  it.each(others)('should delegate $type/$provider unchanged and never capture it', async (auth) => {
    const { run } = fixture();
    const fallback = { generate: vi.fn().mockResolvedValue({ sentinel: true }), stream: vi.fn().mockResolvedValue(success) };
    const client = new ClaudeCodeRuntimeClient({ runner: { run }, capabilities, fallback });
    const input = { ...request(), temperature: 0.2, auth }; const context = { auth, metadata: { marker: true } };
    expect(await client.generate(input, context)).toEqual({ sentinel: true });
    expect(await client.stream(input, context)).toBe(success);
    expect(fallback.generate).toHaveBeenCalledWith(input, context);
    expect(fallback.stream).toHaveBeenCalledWith(input, context);
    expect(run).not.toHaveBeenCalled();
    const missing = fixture();
    await expect(missing.client.generate(input, context)).rejects.toMatchObject({ code: 'claude_cli_auth' });
    await expect(missing.client.stream(input, context)).rejects.toMatchObject({ code: 'claude_cli_auth' });
    expect(missing.run).not.toHaveBeenCalled();
  });

  it.each([
    { accessToken: '' }, { expiresAt: undefined }, { expiresAt: 'invalid' },
    { expiresAt: new Date(now).toISOString() }, { expiresAt: new Date(now - 1).toISOString() },
    { metadata: {} }, { metadata: { scopes: [] } }, { metadata: { scopes: ['user:profile'] } },
    { metadata: { scopes: ['user:inference', 3] } }, { status: 'planned' },
  ])('should refuse invalid or missing projection %j before the runner', async (patch) => {
    const { client, run } = fixture();
    const auth = { ...credential(), ...patch } as AuthInput;
    await expect(client.generate(request(), { auth })).rejects.toMatchObject({ code: 'claude_cli_auth' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Claude CLI failure and lifecycle boundaries', () => {
  const canary = 'fake-access-canary fake-refresh-canary raw-child-output';
  const assertSafe = (error: unknown) => {
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain('canary');
    expect(String(error)).not.toContain('raw-child-output');
    expect(JSON.stringify(error)).not.toMatch(/canary|raw-child-output/);
    expect(error).not.toHaveProperty('cause');
    expect((error as Error).stack).not.toMatch(/canary|raw-child-output/);
  };
  it.each(['sync', 'next', 'event', 'after-result'])('should sanitize %s failures without direct fallback', async (mode) => {
    const run = vi.fn<ClaudeCodeCliRunner['run']>(() => {
      if (mode === 'sync') throw new Error(canary);
      return (async function* () {
        if (mode === 'after-result') yield success[1];
        if (mode === 'event') yield { type: 'error', message: canary } as ClaudeCodeCliEvent;
        throw Object.assign(new Error(canary), { cause: { token: canary }, status: 401 });
      })();
    });
    const fallback = { generate: vi.fn(), stream: vi.fn() };
    const client = new ClaudeCodeRuntimeClient({ runner: { run }, capabilities, fallback, now: () => now });
    const error = await client.generate(request(), { auth: credential() }).catch((e) => e);
    assertSafe(error);
    expect(error.code).toBe('claude_cli_runner');
    expect(fallback.generate).not.toHaveBeenCalled(); expect(fallback.stream).not.toHaveBeenCalled();
  });

  it.each([
    [], [success[0]], [success[1], success[1]], [success[1], success[0]],
    [{ type: 'raw', message: canary }], [{ type: 'text_delta', text: 3 }],
    [{ type: 'result', finishReason: 'other' }], [{ type: 'result', finishReason: 'tool_calls' }],
    [{ type: 'result', finishReason: 'stop', usage: { inputTokens: -1 } }],
    [{ type: 'result', finishReason: 'stop', usage: { outputTokens: NaN } }],
    [{ type: 'result', finishReason: 'stop', usage: { outputTokens: 1.5 } }],
    [{ type: 'tool_use', id: 'call', name: 'undeclared', input: {} }],
  ])('should reject truncated, malformed or contradictory event sequence %j', async (...events) => {
    const { client } = fixture(events as ClaudeCodeCliEvent[]);
    assertSafe(await client.generate(request(), { auth: credential() }).catch((e) => e));
  });

  it('should discard raw result metadata and preserve length and partial usage', async () => {
    const { client } = fixture([{ type: 'result', finishReason: 'length', usage: { outputTokens: 2,
      providerRawUsage: canary }, raw: canary } as ClaudeCodeCliEvent]);
    const response = await client.generate(request(), { auth: credential() });
    expect(response).toMatchObject({ finishReason: 'length', usage: { outputTokens: 2 } });
    expect(response.usage).toEqual({ outputTokens: 2 });
    expect(JSON.stringify(response)).not.toMatch(/canary|raw-child-output/);
  });

  it('should refuse already aborted requests without exposing the reason or calling the runner', async () => {
    const { client, run } = fixture(); const controller = new AbortController(); controller.abort(canary);
    const error = await client.stream({ ...request(), signal: controller.signal }, { auth: credential() }).catch((e) => e);
    assertSafe(error); expect(error.name).toBe('AbortError'); expect(run).not.toHaveBeenCalled();
  });

  it('should abort a pending read promptly and ask the host to close with a safe reason', async () => {
    let childSignal: AbortSignal | undefined;
    const returned = vi.fn(async () => ({ done: true as const, value: undefined }));
    let started!: () => void; const reading = new Promise<void>((resolve) => { started = resolve; });
    const runner: ClaudeCodeCliRunner = { run({ signal }) { childSignal = signal;
      return { [Symbol.asyncIterator]: () => ({ next: () => { started(); return new Promise(() => {}); }, return: returned }) };
    } };
    const client = new ClaudeCodeRuntimeClient({ runner, capabilities, now: () => now });
    const controller = new AbortController();
    const pending = client.generate({ ...request(), signal: controller.signal }, { auth: credential() }).catch((e) => e);
    await reading; controller.abort(canary);
    const error = await pending; assertSafe(error); expect(error.name).toBe('AbortError');
    expect(childSignal?.aborted).toBe(true); expect(String(childSignal?.reason)).not.toContain(canary);
    expect(returned).toHaveBeenCalledOnce();
  });

  it('should cancel the runner on consumer early-close and detach the caller abort listener', async () => {
    const { client, run } = fixture(); const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    for await (const event of await client.stream({ ...request(), signal: controller.signal }, { auth: credential() })) {
      expect(event.type).toBe('content_delta'); break;
    }
    expect(run.mock.calls[0][0].signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('should recheck expiry before deferred iteration and never spawn with a stale projection', async () => {
    const { run } = fixture(); let clock = now;
    const client = new ClaudeCodeRuntimeClient({ runner: { run }, capabilities, now: () => clock });
    const source = await client.stream(request(), { auth: credential() }); clock += 60_000;
    await expect(collect(source)).rejects.toMatchObject({ code: 'claude_cli_runner' });
    expect(run).not.toHaveBeenCalled();
  });
});

describe('Claude CLI tool history integrity', () => {
  const caps = { ...capabilities, tools: 'fake-tools-qualified', history: 'fake-history-qualified' };
  const call = { toolCallId: 'call-1', providerCallId: 'provider-1', name: 'lookup', argumentsText: '{"q":"test"}' };
  const assistant = { role: 'assistant' as const, content: '', toolCalls: [call] };
  const result = { role: 'tool' as const, content: '',
    toolResult: { toolCallId: 'call-1', providerCallId: 'provider-1', name: 'lookup', output: 'found' } };
  const tool = { type: 'function' as const, name: 'lookup', inputSchema: { type: 'object' } };
  it.each([
    [result], [assistant], [assistant, result, result],
    [assistant, { ...result, toolResult: { ...result.toolResult, providerCallId: 'wrong-id' } }],
    [{ ...assistant, toolCalls: [call, call] }, result],
    [assistant, { ...result, toolResult: { ...result.toolResult, name: 'wrong-tool' } }],
    [{ ...assistant, toolCalls: [{ ...call, argumentsText: '[]' }] }, result],
    [{ ...assistant, toolCalls: [{ ...call, metadata: { ignored: true } }] }, result],
    [assistant, { ...result, content: 'silently lost' }],
  ])('should refuse unmatched, incomplete or lossy tool history %j before run', async (...messages) => {
    const { client, run } = fixture(success, caps);
    await expect(client.generate({ ...request(), tools: [tool],
      messages: [...request().messages, ...messages] } as StreamRequest, { auth: credential() }))
      .rejects.toMatchObject({ code: 'claude_cli_unsupported' });
    expect(run).not.toHaveBeenCalled();
  });
  it('should snapshot tool schemas before deferred iteration', async () => {
    const { client, run } = fixture(success, caps);
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    const source = await client.stream({ ...request(), tools: [{ ...tool, inputSchema: schema }] }, { auth: credential() });
    schema.properties.q.type = 'number';
    await collect(source);
    expect(run.mock.calls[0][0].request.tools?.[0].inputSchema).toEqual({ type: 'object', properties: { q: { type: 'string' } } });
  });
});

describe('Claude CLI final protocol checks', () => {
  it.each([null, [], 'raw-child-output'].map((usage) => ({ usage })))(
    'should refuse malformed usage $usage', async ({ usage }) => {
    const { client } = fixture([{ type: 'result', finishReason: 'stop', usage } as ClaudeCodeCliEvent]);
    await expect(client.generate(request(), { auth: credential() })).rejects.toMatchObject({ code: 'claude_cli_runner' });
  });
  it('should refuse usage totals outside the safe integer range', async () => {
    const { client } = fixture([{ type: 'result', finishReason: 'stop',
      usage: { inputTokens: Number.MAX_SAFE_INTEGER, outputTokens: 1 } }]);
    await expect(client.generate(request(), { auth: credential() })).rejects.toMatchObject({ code: 'claude_cli_runner' });
  });
  const call: ClaudeCodeCliEvent = { type: 'tool_use', id: 'id', name: 'lookup', input: { q: 'test' } };
  const toolRequest = { ...request(), tools: [{ type: 'function' as const, name: 'lookup', inputSchema: { type: 'object' } }] };
  it.each([
    [call, call], [call, { type: 'result', finishReason: 'stop' }],
    [{ ...call, input: { bad: undefined } }], [{ ...call, input: [] }], [{ ...call, input: null }],
  ])('should refuse duplicate, lossy or contradictory tool output %j', async (...events) => {
    const { client } = fixture([...events, { type: 'result', finishReason: 'tool_calls' }] as ClaudeCodeCliEvent[],
      { ...capabilities, tools: 'fake-qualified-tools' });
    await expect(client.generate(toolRequest, { auth: credential() })).rejects.toMatchObject({ code: 'claude_cli_runner' });
  });
  it('should stream complete tool arguments once before a tool terminal result', async () => {
    const { client } = fixture([call, { type: 'result', finishReason: 'tool_calls' }],
      { ...capabilities, tools: 'fake-qualified-tools' });
    expect(await collect(await client.stream(toolRequest, { auth: credential() }))).toEqual([
      { type: 'tool_call_start', data: { toolCallId: 'id', providerCallId: 'id', name: 'lookup',
        argumentsText: '{"q":"test"}', arguments: { q: 'test' }, inputState: 'complete' } },
      { type: 'done', data: { finishReason: 'tool_calls', providerId: 'anthropic', modelId: request().modelId } },
    ]);
  });
  it('should not invoke the runner if aborted between stream creation and iteration', async () => {
    const { client, run } = fixture(); const controller = new AbortController();
    const source = await client.stream({ ...request(), signal: controller.signal }, { auth: credential() });
    controller.abort('fake-canary');
    await expect(collect(source)).rejects.toMatchObject({ name: 'AbortError', code: 'claude_cli_aborted' });
    expect(run).not.toHaveBeenCalled();
  });
});
