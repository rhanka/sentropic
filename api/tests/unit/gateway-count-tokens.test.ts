/**
 * Gateway count_tokens host port (spec §15.2 round 2): the port resolves the
 * trusted server credential (user provider credential or the owner's
 * claude-code account transport) and relays the caller body to the Anthropic
 * Messages count_tokens endpoint. These tests pin the credential selection,
 * the lease lifecycle and the provider-shaped failure mapping — no network,
 * no database (module chains mocked, client injected).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedRoutingSubject } from '@sentropic/llm-mesh';

const { resolveCredential, transportMode, primaryAccount, acquire } = vi.hoisted(() => ({
  resolveCredential: vi.fn(),
  transportMode: vi.fn(),
  primaryAccount: vi.fn(),
  acquire: vi.fn(),
}));

vi.mock('../../src/services/provider-credentials', () => ({
  resolveProviderCredential: resolveCredential,
}));
vi.mock('../../src/services/provider-connections', () => ({
  getAnthropicTransportMode: transportMode,
  resolveConnectedClaudeCodeTransport: acquire,
}));
vi.mock('../../src/services/llm-account-transports', () => ({
  getPrimaryClaudeCodeAccountTransport: primaryAccount,
}));
vi.mock('../../src/services/provider-registry', () => ({
  providerRegistry: {
    listModels: () => [
      { providerId: 'anthropic', modelId: 'claude-opus-5' },
      { providerId: 'openai', modelId: 'gpt-5.5' },
    ],
  },
}));

import { createGatewayCountTokensPort } from '../../src/services/llm-runtime/gateway-count-tokens';
import type { CountClient, GatewayCountDependencies } from '../../src/services/llm-runtime/gateway-count-tokens';

const SUBJECT: VerifiedRoutingSubject = { principalRef: 'user-1', ownerScopeRef: 'enrolled:user-1' };
const PREPARE_INPUT = { workspaceId: 'ws-1', modelId: 'claude-opus-5', signal: new AbortController().signal };

const countRequest = (body: Record<string, unknown> = { model: 'claude-opus-5', messages: [] }) => ({
  body,
  headers: { forwarded: { 'anthropic-beta': 'future' }, anthropicVersion: '2023-06-01' },
  signal: new AbortController().signal,
  requestId: 'req-count-1',
});

const portFor = (
  client: Pick<CountClient, 'countTokens'>,
  overrides: Partial<GatewayCountDependencies> = {},
) => createGatewayCountTokensPort({
  resolveCredential,
  transportMode,
  primaryAccount,
  acquire,
  createClient: () => client,
  ...overrides,
});

const responseOf = async (run: () => Promise<unknown>): Promise<{ status: number; body: Record<string, unknown> ; headers?: Record<string, string> }> => {
  try {
    await run();
    expect.unreachable('the port must fail');
  } catch (error) {
    const response = (error as { response?: { status: number; body: Record<string, unknown>; headers?: Record<string, string> } }).response;
    expect(response).toBeTruthy();
    return response!;
  }
};

describe('createGatewayCountTokensPort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists only anthropic catalog models and prepares a token capability', async () => {
    resolveCredential.mockResolvedValue({ credential: 'server-key' });
    const countTokens = vi.fn(async () => ({ input_tokens: 42 }));
    const port = portFor({ countTokens });
    expect(port.modelIds).toEqual(['claude-opus-5']);
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    expect(capability).toMatchObject({ providerId: 'anthropic', modelId: 'claude-opus-5', apiVersions: ['2023-06-01'] });
    const request = countRequest();
    const result = await capability!.execute(request);
    expect(result).toEqual({ kind: 'json', status: 200, headers: {}, body: { input_tokens: 42 } });
    expect(countTokens).toHaveBeenCalledWith(request.body, {
      signal: request.signal,
      headers: { 'anthropic-beta': 'future', 'anthropic-version': '2023-06-01' },
    });
  });

  it('refuses non-anthropic models before any credential resolution', async () => {
    const port = portFor({ countTokens: vi.fn() });
    expect(await port.prepare(SUBJECT, { ...PREPARE_INPUT, modelId: 'gpt-5.5' })).toBeUndefined();
    expect(await port.prepare(SUBJECT, { ...PREPARE_INPUT, modelId: 'claude-absent-9' })).toBeUndefined();
    expect(resolveCredential).not.toHaveBeenCalled();
  });

  it('refuses when no credential exists and the transport mode is token', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('token');
    const port = portFor({ countTokens: vi.fn() });
    expect(await port.prepare(SUBJECT, PREPARE_INPUT)).toBeUndefined();
    expect(primaryAccount).not.toHaveBeenCalled();
  });

  it('prepares an account capability for an active claude-code transport and releases the lease', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('claude-code');
    primaryAccount.mockResolvedValue({ status: 'active' });
    const recordOutcome = vi.fn(async () => undefined);
    acquire.mockResolvedValue({ accessToken: 'account-access-token', recordOutcome });
    const countTokens = vi.fn(async () => ({ input_tokens: 7 }));
    const port = portFor({ countTokens });
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    expect(capability).toBeTruthy();
    const request = countRequest();
    expect((await capability!.execute(request)).body).toEqual({ input_tokens: 7 });
    expect(acquire).toHaveBeenCalledWith('user-1', { workspaceId: 'ws-1', modelId: 'claude-opus-5', requestId: 'req-count-1' });
    expect(countTokens).toHaveBeenCalledWith(request.body, {
      signal: request.signal,
      headers: { 'anthropic-beta': 'future', 'anthropic-version': '2023-06-01' },
    });
    expect(recordOutcome).toHaveBeenCalledWith({ status: 'success' });
  });

  it('refuses a reauth-required claude-code account', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('claude-code');
    primaryAccount.mockResolvedValue({ status: 'reauth_required' });
    const port = portFor({ countTokens: vi.fn() });
    expect(await port.prepare(SUBJECT, PREPARE_INPUT)).toBeUndefined();
  });

  it('fails closed with a provider-shaped 503 when no lease is available', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('claude-code');
    primaryAccount.mockResolvedValue({ status: 'cooldown' });
    acquire.mockResolvedValue(null);
    const port = portFor({ countTokens: vi.fn() });
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    const response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      type: 'error', error: { type: 'overloaded_error', message: 'account service temporarily unavailable' },
    });
  });

  it('maps provider rate limits with Retry-After and a neutral lease outcome', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('claude-code');
    primaryAccount.mockResolvedValue({ status: 'active' });
    const recordOutcome = vi.fn(async () => undefined);
    acquire.mockResolvedValue({ accessToken: 'account-access-token', recordOutcome });
    const countTokens = vi.fn(async () => {
      throw Object.assign(new Error('rate limited'), {
        status: 429,
        error: { type: 'rate_limit_error', message: 'slow down' },
        headers: new Headers({ 'retry-after': '9' }),
      });
    });
    const port = portFor({ countTokens });
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    const response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(429);
    expect(response.headers).toEqual({ 'Retry-After': '9' });
    expect(response.body).toEqual({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
    expect(recordOutcome).toHaveBeenCalledWith({ status: 'failed', providerStatusCode: 429 });
  });

  it('never puts the account in reauth_required on a counting auth failure', async () => {
    resolveCredential.mockResolvedValue({ credential: undefined });
    transportMode.mockResolvedValue('claude-code');
    primaryAccount.mockResolvedValue({ status: 'active' });
    const recordOutcome = vi.fn(async () => undefined);
    acquire.mockResolvedValue({ accessToken: 'account-access-token', recordOutcome });
    const countTokens = vi.fn(async () => {
      throw Object.assign(new Error('auth failed'), {
        status: 403,
        error: { type: 'authentication_error', message: 'oauth token not accepted' },
      });
    });
    const port = portFor({ countTokens });
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    const response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'error', error: { type: 'authentication_error', message: 'authentication failed' } });
    expect(recordOutcome).toHaveBeenCalledWith({ status: 'failed', providerStatusCode: 403 });
  });

  it('maps provider auth failures to a generic 401 without credential detail', async () => {
    resolveCredential.mockResolvedValue({ credential: 'server-key' });
    const countTokens = vi.fn(async () => {
      throw Object.assign(new Error('auth failed'), {
        status: 401,
        error: { type: 'authentication_error', message: 'invalid x-api-key sk-secret' },
      });
    });
    const port = portFor({ countTokens });
    const capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    const response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ type: 'error', error: { type: 'authentication_error', message: 'authentication failed' } });
  });

  it('maps provider request errors and network failures to sanitized provider shapes', async () => {
    resolveCredential.mockResolvedValue({ credential: 'server-key' });
    const badRequest = vi.fn(async () => {
      throw Object.assign(new Error('bad'), {
        status: 400, error: { type: 'invalid_request_error', message: 'max_tokens is required' },
      });
    });
    let port = portFor({ countTokens: badRequest });
    let capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    let response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens is required' },
    });
    const network = vi.fn(async () => { throw new Error('ECONNRESET internal-host:9443'); });
    port = portFor({ countTokens: network });
    capability = await port.prepare(SUBJECT, PREPARE_INPUT);
    response = await responseOf(() => capability!.execute(countRequest()));
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      type: 'error', error: { type: 'api_error', message: 'counting service temporarily unavailable' },
    });
  });
});
