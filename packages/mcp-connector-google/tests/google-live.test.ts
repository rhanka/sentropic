/** HERMETIC live-adapter tests: every request uses a mocked global fetch. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConnectorProviderAdapter, StpConnectorContext } from '../../mcp-platform/src/runtime.js';
import { gmailLiveAdapter, googleDriveLiveAdapter } from '../src/live-adapter.js';
import { getDriveFileLive, getGmailMessageLive } from '../src/live-executors.js';

const testToken = 'google-live-test-token-value';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'mock',
    headers: { get: () => null },
    json: async () => body,
  }));
}

function makeCtx(token = testToken): {
  ctx: StpConnectorContext;
  getSecret: ReturnType<typeof vi.fn>;
  auditEvents: unknown[];
} {
  const auditEvents: unknown[] = [];
  const getSecret = vi.fn(async () => token);
  return {
    ctx: {
      requestId: 'google-live-request',
      correlationId: 'google-live-correlation',
      auditId: 'google-live-audit',
      principal: {
        sub: 'user-1',
        claims: {},
        scopes: [],
        tenantRef: 'tenant-1',
        authTime: new Date().toISOString(),
      },
      surface: 'backend',
      session: { mcpSessionId: 'google-live-session' },
      tenantRef: 'tenant-1',
      connectorInstanceId: 'google-account-1',
      consentRefs: [],
      grantRefs: [],
      getSecret: getSecret as StpConnectorContext['getSecret'],
      connectorConfig: {},
      audit: { emit: async (event: unknown) => auditEvents.push(event) },
      logger: console,
    },
    getSecret,
    auditEvents,
  };
}

type LiveCase = {
  label: string;
  adapter: AppConnectorProviderAdapter;
  capabilityRef: string;
  input: unknown;
  resource?: boolean;
  url: string;
};

type SecretFailureOperation = {
  label: string;
  execute: (ctx: StpConnectorContext) => Promise<unknown>;
};

const secretFailureOperations: SecretFailureOperation[] = [
  {
    label: 'resource reads',
    execute: (ctx) => googleDriveLiveAdapter.readResource({
      capabilityRef: 'about.get',
      input: { uri: 'google-drive://about' },
      ctx,
    }),
  },
  {
    label: 'tool invocations',
    execute: (ctx) => gmailLiveAdapter.invokeTool({ capabilityRef: 'labels.list', input: {}, ctx }),
  },
];

const liveCases: LiveCase[] = [
  {
    label: 'Drive about.get',
    adapter: googleDriveLiveAdapter,
    capabilityRef: 'about.get',
    input: { uri: 'google-drive://about' },
    resource: true,
    url: 'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress%2CdisplayName%2CpermissionId)%2CstorageQuota',
  },
  {
    label: 'Drive files.get',
    adapter: googleDriveLiveAdapter,
    capabilityRef: 'files.get',
    input: { uri: 'google-drive://files/drive file' },
    resource: true,
    url: 'https://www.googleapis.com/drive/v3/files/drive%20file',
  },
  {
    label: 'Drive files.list',
    adapter: googleDriveLiveAdapter,
    capabilityRef: 'files.list',
    input: { query: "fullText contains 'plan'" },
    url: "https://www.googleapis.com/drive/v3/files?q=fullText%20contains%20'plan'",
  },
  {
    label: 'Drive files.export',
    adapter: googleDriveLiveAdapter,
    capabilityRef: 'files.export',
    input: { fileId: 'drive/file', mimeType: 'text/plain' },
    url: 'https://www.googleapis.com/drive/v3/files/drive%2Ffile/export?mimeType=text%2Fplain',
  },
  {
    label: 'Drive permissions.list',
    adapter: googleDriveLiveAdapter,
    capabilityRef: 'permissions.list',
    input: { fileId: 'drive/file' },
    url: 'https://www.googleapis.com/drive/v3/files/drive%2Ffile/permissions',
  },
  {
    label: 'Gmail messages.get',
    adapter: gmailLiveAdapter,
    capabilityRef: 'messages.get',
    input: { uri: 'gmail://messages/message id' },
    resource: true,
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/message%20id',
  },
  {
    label: 'Gmail threads.get',
    adapter: gmailLiveAdapter,
    capabilityRef: 'threads.get',
    input: { uri: 'gmail://threads/thread id' },
    resource: true,
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread%20id',
  },
  {
    label: 'Gmail messages.list',
    adapter: gmailLiveAdapter,
    capabilityRef: 'messages.list',
    input: { query: 'from:alice@example.com' },
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=from%3Aalice%40example.com',
  },
  {
    label: 'Gmail labels.list',
    adapter: gmailLiveAdapter,
    capabilityRef: 'labels.list',
    input: {},
    url: 'https://gmail.googleapis.com/gmail/v1/users/me/labels',
  },
];

describe('Google live adapters (mocked global fetch; no real network)', () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const liveCase of liveCases) {
    it(`${liveCase.label} builds its Google API URL and uses the secret-by-reference token`, async () => {
      const fetchSpy = mockFetchOnce(200, { capability: liveCase.capabilityRef });
      vi.stubGlobal('fetch', fetchSpy);
      const { ctx, getSecret, auditEvents } = makeCtx();
      const result = liveCase.resource
        ? await liveCase.adapter.readResource({
            capabilityRef: liveCase.capabilityRef,
            input: liveCase.input as { uri: string },
            ctx,
          })
        : await liveCase.adapter.invokeTool({
            capabilityRef: liveCase.capabilityRef,
            input: liveCase.input,
            ctx,
          });

      expect(typeof result).not.toBe('string');
      if (typeof result === 'string') throw new Error('read-only live tool returned a durable call reference');
      expect(result).toMatchObject({ ok: true, output: { capability: liveCase.capabilityRef } });
      expect(getSecret).toHaveBeenCalledOnce();
      expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string>; signal: AbortSignal }];
      expect(url).toBe(liveCase.url);
      expect(init.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${testToken}` });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(JSON.stringify({ result, auditEvents })).not.toContain(testToken);
    });
  }

  it('omits Authorization when ctx.getSecret resolves an empty token', async () => {
    const fetchSpy = mockFetchOnce(200, { labels: [] });
    vi.stubGlobal('fetch', fetchSpy);
    const { ctx, getSecret, auditEvents } = makeCtx('');

    const result = await gmailLiveAdapter.invokeTool({ capabilityRef: 'labels.list', input: {}, ctx });

    expect(typeof result).not.toBe('string');
    if (typeof result === 'string') throw new Error('read-only live tool returned a durable call reference');
    const [, init] = fetchSpy.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(result.ok).toBe(true);
    expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
    expect(init.headers).toEqual({ Accept: 'application/json' });
    expect(JSON.stringify({ result, auditEvents })).not.toContain(testToken);
  });

  it('maps SecretAccessError failures to non-retriable secret-unavailable envelopes without egress', async () => {
    const secretValue = 'secret-access-error-value';

    for (const operation of secretFailureOperations) {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const cause = Object.assign(new Error(secretValue), { name: 'SecretAccessError' });
      const { ctx, getSecret, auditEvents } = makeCtx();
      getSecret.mockRejectedValueOnce(cause);

      const result = await operation.execute(ctx);

      expect(result).toMatchObject({
        ok: false,
        error: { code: 'connector_secret_unavailable', retriable: false },
      });
      expect((result as { error?: Record<string, unknown> }).error).not.toHaveProperty('detail');
      expect(getSecret).toHaveBeenCalledOnce();
      expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify({ result, auditEvents })).not.toContain(secretValue);
    }
  });

  it('maps SecretEnvelopeError failures to retriable unreadable-secret envelopes without values', async () => {
    const encryptedValue = 'encrypted-secret-envelope-value';
    const decryptedValue = 'decrypted-secret-envelope-value';

    for (const operation of secretFailureOperations) {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const cause = Object.assign(new Error(encryptedValue), {
        name: 'SecretEnvelopeError',
        reason: 'unknown-version',
        version: 'v99',
        encryptedValue,
        decryptedValue,
      });
      const { ctx, getSecret, auditEvents } = makeCtx();
      getSecret.mockRejectedValueOnce(cause);

      const result = await operation.execute(ctx);

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'connector_secret_unreadable',
          retriable: true,
          detail: { reason: 'unknown-version', version: 'v99' },
        },
      });
      expect(getSecret).toHaveBeenCalledOnce();
      expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(JSON.stringify({ result, auditEvents })).not.toContain(encryptedValue);
      expect(JSON.stringify({ result, auditEvents })).not.toContain(decryptedValue);
    }
  });

  it('propagates unrelated getSecret failures unchanged instead of converting them to connector envelopes', async () => {
    for (const operation of secretFailureOperations) {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      const cause = new TypeError('unrelated secret access failure');
      const { ctx, getSecret } = makeCtx();
      getSecret.mockRejectedValueOnce(cause);

      await expect(operation.execute(ctx)).rejects.toBe(cause);
      expect(getSecret).toHaveBeenCalledOnce();
      expect(getSecret).toHaveBeenCalledWith('googleOAuthAccessToken');
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  });

  it('maps non-2xx responses to typed errors with the correct retriable state', async () => {
    const { ctx: notFoundCtx } = makeCtx();
    vi.stubGlobal('fetch', mockFetchOnce(404, { error: { message: 'missing' } }));
    const notFound = await googleDriveLiveAdapter.readResource({
      capabilityRef: 'about.get',
      input: { uri: 'google-drive://about' },
      ctx: notFoundCtx,
    });
    expect(notFound.error).toMatchObject({ code: 'google_api_error_404', retriable: false });

    const { ctx: unavailableCtx } = makeCtx();
    vi.stubGlobal('fetch', mockFetchOnce(503, { error: { message: 'unavailable' } }));
    const unavailable = await gmailLiveAdapter.invokeTool({
      capabilityRef: 'labels.list',
      input: {},
      ctx: unavailableCtx,
    });
    if (typeof unavailable === 'string') throw new Error('read-only live tool returned a durable call reference');
    expect(unavailable.error).toMatchObject({ code: 'google_api_error_503', retriable: true });

    const { ctx: rateLimitedCtx } = makeCtx();
    vi.stubGlobal('fetch', mockFetchOnce(429, { error: { message: 'rate limited' } }));
    const rateLimited = await googleDriveLiveAdapter.invokeTool({
      capabilityRef: 'files.list',
      input: {},
      ctx: rateLimitedCtx,
    });
    if (typeof rateLimited === 'string') throw new Error('read-only live tool returned a durable call reference');
    expect(rateLimited.error).toMatchObject({ code: 'google_api_error_429', retriable: true });
  });

  it('maps timeout and transport throws to typed retriable errors', async () => {
    const timeoutFetch = vi.fn(async () => {
      const error = new Error('aborted');
      error.name = 'TimeoutError';
      throw error;
    });
    vi.stubGlobal('fetch', timeoutFetch);
    const { ctx: timeoutCtx } = makeCtx();
    const timedOut = await gmailLiveAdapter.readResource({
      capabilityRef: 'messages.get',
      input: { uri: 'gmail://messages/message-1' },
      ctx: timeoutCtx,
    });
    expect(timedOut.error).toMatchObject({ code: 'google_request_timeout', retriable: true });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const { ctx: transportCtx } = makeCtx();
    const transport = await gmailLiveAdapter.invokeTool({
      capabilityRef: 'labels.list',
      input: {},
      ctx: transportCtx,
    });
    if (typeof transport === 'string') throw new Error('read-only live tool returned a durable call reference');
    expect(transport.error).toMatchObject({ code: 'google_transport_error', retriable: true });
  });

  it('rejects dot, dot-dot, and empty identifier segments before fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    for (const fileId of ['.', '..', '']) {
      const error = await getDriveFileLive({ fileId }, testToken).catch((cause) => cause);
      expect(error).toMatchObject({ code: 'google_invalid_input', retriable: false });
    }
    for (const messageId of ['.', '..', '']) {
      const error = await getGmailMessageLive({ messageId }, testToken).catch((cause) => cause);
      expect(error).toMatchObject({ code: 'google_invalid_input', retriable: false });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
