import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDefaultFetchTransport } from '../src/transport-fetch.js';
import { assertAuthUiTransport } from '../src/index.js';

const makeResponse = (body: unknown, init: { status?: number } = {}): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });

describe('default fetch transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('exposes the full AuthUiTransport contract', () => {
    fetchMock.mockResolvedValue(makeResponse({}));
    const transport = createDefaultFetchTransport({ baseUrl: '/auth', fetch: fetchMock });
    expect(assertAuthUiTransport(transport)).toBe(transport);
  });

  it('mounts each method under the configured base URL prefix', async () => {
    fetchMock.mockResolvedValue(makeResponse({ delivery: 'email' }));
    const transport = createDefaultFetchTransport({ baseUrl: '/admin/auth', fetch: fetchMock });

    await transport.requestEmailCode({ email: 'user@example.com' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/auth/email/verify-request',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends static headers and credentials by default', async () => {
    fetchMock.mockResolvedValue(makeResponse({}));
    const transport = createDefaultFetchTransport({
      baseUrl: '/auth',
      fetch: fetchMock,
      headers: { 'x-tenant': 'workspace-42' },
    });

    await transport.listCredentials();
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe('include');
    expect((init.headers as Record<string, string>)['x-tenant']).toBe('workspace-42');
  });

  it('maps approveDevicePairing camelCase input to snake_case body', async () => {
    fetchMock.mockResolvedValue(makeResponse({ deviceName: 'Laptop' }));
    const transport = createDefaultFetchTransport({ baseUrl: '/auth', fetch: fetchMock });

    await transport.approveDevicePairing({ userCode: 'PAIR-1234', deviceName: 'Laptop' });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ user_code: 'PAIR-1234', device_name: 'Laptop' });
  });

  it('returns AuthUiResult error on non-2xx responses with server message', async () => {
    fetchMock.mockResolvedValue(makeResponse({ message: 'Invalid code' }, { status: 400 }));
    const transport = createDefaultFetchTransport({ baseUrl: '/auth', fetch: fetchMock });

    const result = await transport.verifyEmailCode({ email: 'u@example.com', code: '000000' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('transport_error');
      expect(result.error.message).toBe('Invalid code');
    }
  });

  it('triggers onUnauthorized when an authenticated request gets 401', async () => {
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(makeResponse({ message: 'no session' }, { status: 401 }));
    const transport = createDefaultFetchTransport({
      baseUrl: '/auth',
      fetch: fetchMock,
      onUnauthorized,
    });

    await transport.listCredentials();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not trigger onUnauthorized for public 401s (login/options)', async () => {
    const onUnauthorized = vi.fn();
    fetchMock.mockResolvedValue(makeResponse({ message: 'rate-limited' }, { status: 401 }));
    const transport = createDefaultFetchTransport({
      baseUrl: '/auth',
      fetch: fetchMock,
      onUnauthorized,
    });

    await transport.createPasskeyAuthenticationOptions({});
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('classifies network exceptions as retryable transport_error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const transport = createDefaultFetchTransport({ baseUrl: '/auth', fetch: fetchMock });

    const result = await transport.refreshSession();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('transport_error');
      expect(result.error.retryable).toBe(true);
    }
  });
});
