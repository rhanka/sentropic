import { describe, expect, it } from 'vitest';
import {
  MISTRAL_VIBE_SIGN_IN_URL,
  MistralVibeEnrollmentProvider,
} from '../../src/enrollment/mistral-vibe.js';
import type { StartEnrollmentInput } from '../../src/enrollment/index.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const startInput: StartEnrollmentInput = {
  configRef: '',
  mode: 'cli',
  redirectUri: 'http://127.0.0.1:0/callback',
  ownerScope: 'cli:localhost',
};

interface SignResponse {
  process_id: string;
  sign_in_url: string;
  poll_url: string;
  expires_at: string;
}

const signResponse = (): SignResponse => ({
  process_id: 'proc_123',
  sign_in_url: 'https://console.mistral.ai/sign-in/proc_123',
  poll_url: 'https://console.mistral.ai/api/vibe/sign-in/proc_123/poll',
  expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
});

describe('MistralVibeEnrollmentProvider', () => {
  it('starts a PKCE S256 sign-in process and returns the browser url', async () => {
    const bodies: unknown[] = [];
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(200, signResponse());
    }) as unknown as typeof fetch;

    const provider = new MistralVibeEnrollmentProvider({ fetchFn });
    const session = await provider.start(startInput);

    expect(session.kind).toBe('authorization-url');
    expect(session.url).toBe('https://console.mistral.ai/sign-in/proc_123');
    expect(bodies[0]).toEqual({
      code_challenge: expect.stringMatching(/^[A-Za-z0-9_-]{40,}$/),
      code_challenge_method: 'S256',
    });
  });

  it('rejects sign-in urls outside the console origin', async () => {
    const fetchFn = (async () => jsonResponse(200, {
      ...signResponse(),
      sign_in_url: 'https://evil.example.com/sign-in',
    })) as unknown as typeof fetch;

    const provider = new MistralVibeEnrollmentProvider({ fetchFn });
    await expect(provider.start(startInput)).rejects.toThrow(/outside the console origin/);
  });

  it('polls to completion and exchanges the token for an api key', async () => {
    const polls: number[] = [];
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      const target = String(url);
      if (target === MISTRAL_VIBE_SIGN_IN_URL) {
        return jsonResponse(200, signResponse());
      }
      if (target.endsWith('/poll')) {
        polls.push(1);
        return jsonResponse(200, polls.length < 2
          ? { status: 'pending' }
          : { status: 'completed', exchange_token: 'ex_tok' });
      }
      expect(init?.method).toBe('POST');
      expect(target.endsWith('/sign-in/proc_123/exchange')).toBe(true);
      expect(JSON.parse(String(init?.body))).toEqual({
        exchange_token: 'ex_tok',
        code_verifier: expect.any(String),
      });
      return jsonResponse(200, { api_key: 'mistral-key-1' });
    }) as unknown as typeof fetch;

    const provider = new MistralVibeEnrollmentProvider({ fetchFn, sleep: async () => {} });
    const session = await provider.start(startInput);
    const completion = await provider.pollForCompletion(session.enrollmentId, 5);

    expect(completion.accountId).toMatch(/^acct_mistral_vibe_/);
    expect(completion.credential?.accessToken).toBe('mistral-key-1');
    expect(completion.credential?.refreshToken).toBeUndefined();
    expect(completion.ownerScope).toBe('cli:localhost');
  });

  it('fails closed on denied and expired sign-in processes', async () => {
    const denied = new MistralVibeEnrollmentProvider({
      fetchFn: (async (url: unknown) => String(url).endsWith('/poll')
        ? jsonResponse(200, { status: 'denied', message: 'user declined' })
        : jsonResponse(200, signResponse())) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const deniedSession = await denied.start(startInput);
    await expect(denied.pollForCompletion(deniedSession.enrollmentId, 3))
      .rejects.toThrow(/denied: user declined/);

    const expired = new MistralVibeEnrollmentProvider({
      fetchFn: (async (url: unknown) => String(url).endsWith('/poll')
        ? new Response('gone', { status: 410 })
        : jsonResponse(200, signResponse())) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const expiredSession = await expired.start(startInput);
    await expect(expired.pollForCompletion(expiredSession.enrollmentId, 3))
      .rejects.toThrow(/expired/);
  });

  it('does not refresh (long-lived key) and cannot complete without polling', async () => {
    const provider = new MistralVibeEnrollmentProvider({
      fetchFn: (async () => jsonResponse(200, signResponse())) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const session = await provider.start(startInput);

    await expect(provider.refresh({
      accountId: 'acct_mistral_vibe_x',
      credentialVersion: 'v1.0.0',
    })).rejects.toThrow(/re-enroll the account/);
    await expect(provider.complete({ enrollmentId: session.enrollmentId, code: 'x' }))
      .rejects.toThrow(/pollForCompletion/);
  });

  it('cancels an in-flight session', async () => {
    const provider = new MistralVibeEnrollmentProvider({
      fetchFn: (async () => jsonResponse(200, signResponse())) as unknown as typeof fetch,
      sleep: async () => {},
    });
    const session = await provider.start(startInput);
    await provider.cancel(session.enrollmentId);
    await expect(provider.pollForCompletion(session.enrollmentId, 3))
      .rejects.toThrow(/cancelled/);
  });
});
