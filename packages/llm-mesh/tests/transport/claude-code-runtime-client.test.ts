import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultProviderAdapters } from '../../src/adapters.js';
import type { AuthInput, SecretAuthMaterial } from '../../src/auth.js';
import type { StreamRequest } from '../../src/generation.js';
import { ClaudeCodeRuntimeClient, type ClaudeCodeCliCapabilities,
  type ClaudeCodeCliEvent, type ClaudeCodeCliRunner } from '../../src/transport/claude-code-runtime-client.js';

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
