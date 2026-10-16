import { describe, expect, it, vi } from 'vitest';
import { CodexEnrollmentProvider } from '../../src/enrollment/codex.js';

describe('CodexEnrollmentProvider', () => {
  it('starts device flow enrollment and returns device-code session', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          device_auth_id: 'dev_auth_123',
          user_code: 'ABCD-1234',
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    expect(session.kind).toBe('device-code');
    if (session.kind === 'device-code') {
      expect(session.userCode).toBe('ABCD-1234');
      expect(session.verificationUrl).toContain('codex/device');
    }
  });

  it('polls for completion, preserves credential tokens (P0-4), and uses pollIntervalMs (P0-3)', async () => {
    let attempts = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_456',
            user_code: 'XYZ-789',
            interval: 0.01, // 10ms for fast test execution
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('deviceauth/token')) {
        attempts += 1;
        if (attempts === 1) {
          return new Response('Pending', { status: 403 });
        }
        return new Response(
          JSON.stringify({
            authorization_code: 'auth_code_789',
            code_verifier: 'code_verifier_789',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'codex-access-token',
            refresh_token: 'codex-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const res = await provider.pollForCompletion(session.enrollmentId, 5);
    expect(res.accountId).toMatch(/^acct_codex_/);
    expect(res.label).toContain('Codex Account');
    expect(res.credential).toBeDefined();
    expect(res.credential?.accessToken).toBe('codex-access-token');
    expect(res.credential?.refreshToken).toBe('codex-refresh-token');
    expect(attempts).toBe(2);
  });

  it('should complete enrollment when a poll fetch throws one transient network error', async () => {
    let tokenCalls = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_retry',
            user_code: 'RETRY-1',
            interval: 0.01, // 10ms for fast test execution
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('deviceauth/token')) {
        tokenCalls += 1;
        if (tokenCalls === 1) {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ETIMEDOUT' },
          });
        }
        if (tokenCalls === 2) {
          return new Response('Pending', { status: 403 });
        }
        return new Response(
          JSON.stringify({
            authorization_code: 'auth_code_retry',
            code_verifier: 'code_verifier_retry',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('oauth/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'codex-access-token',
            refresh_token: 'codex-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const res = await provider.pollForCompletion(session.enrollmentId, 10);
    expect(res.credential?.accessToken).toBe('codex-access-token');
    expect(tokenCalls).toBe(3);
  });

  it('should abort poll only after retries are exhausted, with cause and URL in the message', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_down',
            user_code: 'DOWN-1',
            interval: 0.01,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      // Canary payload: with a cause code present, the raw system message
      // (which can carry hostnames/paths/secrets) must never ride out.
      throw Object.assign(new TypeError('socket hang up sk-test-fake-secret'), {
        cause: { code: 'ECONNRESET' },
      });
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const error = await provider.pollForCompletion(session.enrollmentId, 60).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect(String((error as Error).message)).toContain('ECONNRESET');
    expect(String((error as Error).message)).toContain('deviceauth/token');
    expect(String((error as Error).message)).not.toContain('sk-test-fake-secret');
    // 1 initial attempt + 3 retries, then abort — never the full 60 attempts.
    expect(mockFetch.mock.calls.filter(([url]) => String(url).includes('deviceauth/token')))
      .toHaveLength(4);
  });

  it('should fall back to the raw message when the network error has no cause code', async () => {
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_nocode',
            user_code: 'NOCODE-1',
            interval: 0.01,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      throw new TypeError('socket hang up');
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const error = await provider.pollForCompletion(session.enrollmentId, 60).then(
      () => { throw new Error('expected rejection'); },
      (error: unknown) => error,
    );
    expect(String((error as Error).message)).toContain('socket hang up');
    expect(String((error as Error).message)).toContain('deviceauth/token');
  });

  it('should complete enrollment when the token exchange throws one transient network error', async () => {
    let exchangeCalls = 0;
    const mockFetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();

      if (urlStr.includes('deviceauth/usercode')) {
        return new Response(
          JSON.stringify({
            device_auth_id: 'dev_auth_exch',
            user_code: 'EXCH-1',
            interval: 0.01,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('deviceauth/token')) {
        return new Response(
          JSON.stringify({
            authorization_code: 'auth_code_exch',
            code_verifier: 'code_verifier_exch',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      if (urlStr.includes('oauth/token')) {
        exchangeCalls += 1;
        if (exchangeCalls === 1) {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'ETIMEDOUT' },
          });
        }
        return new Response(
          JSON.stringify({
            access_token: 'codex-access-token',
            refresh_token: 'codex-refresh-token',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }

      return new Response('Not found', { status: 404 });
    });

    const provider = new CodexEnrollmentProvider({
      fetchFn: mockFetch as unknown as typeof fetch,
    });

    const session = await provider.start({
      configRef: 'vault://codex',
      mode: 'cli',
      redirectUri: 'http://localhost',
      ownerScope: 'test',
    });

    const res = await provider.pollForCompletion(session.enrollmentId, 5);
    expect(res.credential?.accessToken).toBe('codex-access-token');
    expect(exchangeCalls).toBe(2);
  });
});
