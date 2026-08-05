import { describe, expect, it } from 'vitest';
import { createLoopbackServer, generateNonce, generatePkcePair } from '../../src/enrollment/pkce.js';

describe('PKCE & Loopback Server', () => {
  it('generates valid PKCE pair and nonce', () => {
    const pkce = generatePkcePair();
    expect(pkce.codeVerifier).toBeDefined();
    expect(pkce.codeChallenge).toBeDefined();

    const nonce = generateNonce();
    expect(nonce).toBeDefined();
    expect(nonce.length).toBeGreaterThan(10);
  });

  it('ignores non-callback requests like /favicon.ico (P0-2) and handles callback (P1-3)', async () => {
    const state = 'test-nonce-123';
    const server = await createLoopbackServer(state);

    try {
      // 1. Send favicon request -> should return 204
      const faviconRes = await fetch(`http://127.0.0.1:${server.port}/favicon.ico`);
      expect(faviconRes.status).toBe(204);

      // 2. Send valid callback -> should resolve waitForCallback
      const callbackPromise = server.waitForCallback(2000);
      const okRes = await fetch(
        `http://127.0.0.1:${server.port}/oauth/callback?code=auth_code_xyz&state=${state}`,
      );
      expect(okRes.status).toBe(200);

      const result = await callbackPromise;
      expect(result.code).toBe('auth_code_xyz');
      expect(result.state).toBe(state);

      // 3. Replay callback -> should return 200 without throwing double-end error (P1-3)
      const replayRes = await fetch(
        `http://127.0.0.1:${server.port}/oauth/callback?code=auth_code_xyz&state=${state}`,
      );
      expect(replayRes.status).toBe(200);
    } finally {
      await server.close();
    }
  });
});
