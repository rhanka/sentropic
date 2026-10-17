/**
 * m2/m3 — TokenExchangeHttpIssuer unit proofs (no network): RFC 6749 Basic
 * credential encoding, exact minted audience, and bounded body reads.
 * Uses stub fetch/crypto doubles; real HTTP behavior stays in
 * token-exchange-integration.spec.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  RFC8693_GRANT_TYPE,
  TokenExchangeHttpIssuer,
  type MintExchangedTokenInput,
  type TokenExchangeCryptoPort,
} from '../src/index.js';

const ISSUER = 'https://issuer-test.example';
const TARGET = 'https://radar-test.example';
const WORKLOAD_CLIENT = 'immo-mcp-workload';
const WORKLOAD_SECRET = 'test-only-workload-secret';
const WORKLOAD_ACTOR = 'immo-mcp-workload';

function b64u(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
    string,
    unknown
  >;
}

function stubCrypto(): TokenExchangeCryptoPort {
  return {
    createKeySet: async () => ({}),
    verifyJwt: async (token) => decodeJwtPayload(token),
  };
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    tokenEndpoint: `${ISSUER}/oauth/token`,
    issuer: ISSUER,
    jwks: { keys: [] },
    workloadClientId: WORKLOAD_CLIENT,
    clientSecret: WORKLOAD_SECRET,
    actorSub: WORKLOAD_ACTOR,
    crypto: stubCrypto(),
    requestTimeoutMs: 1000,
    maxResponseBytes: 4096,
    ...overrides,
  } as unknown as ConstructorParameters<typeof TokenExchangeHttpIssuer>[0];
}

function mintInput(overrides: Partial<MintExchangedTokenInput> = {}): MintExchangedTokenInput {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    subject: {
      issuer: ISSUER,
      subject: 'user-1',
      audience: [TARGET],
      issuedAtSec: nowSec - 10,
      expiresAtSec: nowSec + 300,
      scope: ['immo:search'],
    },
    subjectToken: 'subject-token',
    audience: TARGET,
    scope: ['immo:search'],
    actorSub: WORKLOAD_ACTOR,
    workloadClientId: WORKLOAD_CLIENT,
    ttlSec: 300,
    nowSec,
    ...overrides,
  };
}

function stubFetchShape(responder: {
  status: number;
  text: string;
  textCalls?: { count: number };
  body?: { getReader(): unknown } | null;
}) {
  return async (_url: string, init: { headers: Record<string, string> }) => ({
    status: responder.status,
    headers: { get: (_name: string) => null },
    text: async () => {
      if (responder.textCalls) responder.textCalls.count += 1;
      return responder.text;
    },
    body: responder.body ?? null,
    capturedAuth: init.headers.authorization,
  });
}

describe('token exchange HTTP issuer units', () => {
  it('m2 encodes Basic credentials per RFC 6749 §2.3.1', async () => {
    let capturedAuth = '';
    const fetchFn = async (_url: string, init: { headers: Record<string, string> }) => {
      capturedAuth = init.headers.authorization;
      return {
        status: 401,
        headers: { get: (_name: string) => null },
        text: async () => JSON.stringify({ error: 'invalid_client' }),
        body: null,
      };
    };
    const issuer = new TokenExchangeHttpIssuer(
      baseOptions({
        workloadClientId: 'work:load',
        clientSecret: 'sécret:with:colons',
        fetchFn,
      }),
    );
    await expect(issuer.mint(mintInput())).rejects.toMatchObject({ code: 'token_exchange_refused' });
    const expected = `Basic ${Buffer.from(
      `${encodeURIComponent('work:load')}:${encodeURIComponent('sécret:with:colons')}`,
      'utf8',
    ).toString('base64')}`;
    expect(capturedAuth).toBe(expected);
  });

  it('m2 keeps unreserved credentials byte-identical', async () => {
    let capturedAuth = '';
    const fetchFn = async (_url: string, init: { headers: Record<string, string> }) => {
      capturedAuth = init.headers.authorization;
      return {
        status: 401,
        headers: { get: (_name: string) => null },
        text: async () => JSON.stringify({ error: 'invalid_client' }),
        body: null,
      };
    };
    const issuer = new TokenExchangeHttpIssuer(baseOptions({ fetchFn }));
    await expect(issuer.mint(mintInput())).rejects.toMatchObject({ code: 'token_exchange_refused' });
    expect(capturedAuth).toBe(
      `Basic ${Buffer.from(`${WORKLOAD_CLIENT}:${WORKLOAD_SECRET}`, 'utf8').toString('base64')}`,
    );
  });

  it('m3 refuses a minted audience that is not the exact requested string', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const mintedPayload = {
      act: { sub: WORKLOAD_ACTOR },
      client_id: WORKLOAD_CLIENT,
      scope: ['immo:search'],
      aud: [TARGET, 'https://evil.example'],
      sub: 'user-1',
      iss: ISSUER,
      iat: nowSec - 5,
      exp: nowSec + 120,
      jti: 'exchange-1',
    };
    const accessToken = `${b64u({ alg: 'EdDSA', kid: 'k1' })}.${b64u(mintedPayload)}.sig`;
    const fetchFn = stubFetchShape({
      status: 200,
      text: JSON.stringify({
        access_token: accessToken,
        token_type: 'Bearer',
        issued_token_type: ACCESS_TOKEN_TYPE,
        scope: 'immo:search',
      }),
    });
    const issuer = new TokenExchangeHttpIssuer(baseOptions({ fetchFn: fetchFn as never }));
    const rejection = await issuer
      .mint(mintInput())
      .then(
        () => ({ code: 'unexpected-success' }),
        (error: unknown) => error as { code: string; reason: string },
      );
    expect(rejection).toMatchObject({ code: 'token_exchange_refused', reason: 'minted_audience_invalid' });
  });

  it('m3 reads fitting bodies via the bounded stream without text()', async () => {
    const textCalls = { count: 0 };
    const pulled = { count: 0 };
    const payload = JSON.stringify({ error: 'invalid_client' });
    const chunks = [payload.slice(0, 10), payload.slice(10, 20), payload.slice(20)];
    const fetchFn = stubFetchShape({
      status: 401,
      text: payload,
      textCalls,
      body: {
        getReader: () => ({
          read: async () => {
            const next = chunks.shift();
            if (next === undefined) return { done: true as const, value: undefined };
            pulled.count += 1;
            return { done: false as const, value: Buffer.from(next, 'utf8') };
          },
          releaseLock: () => {},
        }),
      },
    });
    const issuer = new TokenExchangeHttpIssuer(baseOptions({ fetchFn: fetchFn as never }));
    const rejection = await issuer
      .mint(mintInput())
      .then(
        () => ({ code: 'unexpected-success' }),
        (error: unknown) => error as { code: string; reason: string },
      );
    expect(rejection).toMatchObject({ code: 'token_exchange_refused', reason: 'mint_failed' });
    expect(textCalls.count).toBe(0);
    expect(pulled.count).toBe(3);
  });

  it('m3 refuses oversized streamed bodies having pulled a bounded prefix', async () => {
    const textCalls = { count: 0 };
    const pulled = { count: 0 };
    const chunks = ['x'.repeat(32), 'y'.repeat(32), 'z'.repeat(32), 'w'.repeat(32), 'v'.repeat(32)];
    const fetchFn = stubFetchShape({
      status: 200,
      text: chunks.join(''),
      textCalls,
      body: {
        getReader: () => ({
          read: async () => {
            const next = chunks.shift();
            if (next === undefined) return { done: true as const, value: undefined };
            pulled.count += 1;
            return { done: false as const, value: Buffer.from(next, 'utf8') };
          },
          releaseLock: () => {},
        }),
      },
    });
    const issuer = new TokenExchangeHttpIssuer(
      baseOptions({ fetchFn: fetchFn as never, maxResponseBytes: 64 }),
    );
    const rejection = await issuer
      .mint(mintInput())
      .then(
        () => ({ code: 'unexpected-success' }),
        (error: unknown) => error as { code: string; reason: string },
      );
    expect(rejection).toMatchObject({ code: 'token_exchange_refused', reason: 'mint_failed' });
    expect(textCalls.count).toBe(0);
    expect(pulled.count).toBeLessThanOrEqual(3);
    expect(pulled.count).toBeGreaterThan(0);
  });

  it('m4 refuses a 200 issuer body that does not decode as JSON', async () => {
    const fetchFn = stubFetchShape({ status: 200, text: 'not-json{{{' });
    const issuer = new TokenExchangeHttpIssuer(baseOptions({ fetchFn: fetchFn as never }));
    const rejection = await issuer
      .mint(mintInput())
      .then(
        () => ({ code: 'unexpected-success', message: '' }),
        (error: unknown) => error as { code: string; reason: string; message: string },
      );
    expect(rejection).toMatchObject({ code: 'token_exchange_refused', reason: 'mint_failed' });
    expect(rejection.message).toContain('not JSON');
  });

  it('M7 re-fetches the JWKS after a transient fetch failure', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 500,
          headers: { get: (_name: string) => null },
          text: async () => 'boom',
        };
      }
      return {
        status: 200,
        headers: { get: (_name: string) => null },
        text: async () => JSON.stringify({ keys: [] }),
      };
    };
    const issuer = new TokenExchangeHttpIssuer(
      baseOptions({ jwks: undefined, jwksUri: `${ISSUER}/jwks.json`, fetchFn: fetchFn as never }),
    );
    await expect(issuer.verify('header.payload.sig')).rejects.toMatchObject({
      name: 'SubjectVerificationError',
    });
    expect(calls).toBe(1);
    await expect(issuer.verify('header.payload.sig')).rejects.toMatchObject({
      name: 'SubjectVerificationError',
    });
    expect(calls).toBe(2);
  });

  it('M7 refreshes stale JWKS keys once on signature failure', async () => {
    let jwksCalls = 0;
    const fetchFn = async () => {
      jwksCalls += 1;
      return {
        status: 200,
        headers: { get: (_name: string) => null },
        text: async () => JSON.stringify({ keys: [{ kid: `k${jwksCalls}` }] }),
      };
    };
    const nowSec = Math.floor(Date.now() / 1000);
    const rotatingCrypto: TokenExchangeCryptoPort = {
      createKeySet: (doc: unknown) => doc,
      verifyJwt: async (_token: string, key: unknown) => {
        const doc = key as { keys?: Array<{ kid?: string }> };
        if (doc?.keys?.[0]?.kid === 'k1') {
          throw Object.assign(new Error('signature mismatch'), {
            code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
          });
        }
        return {
          sub: 'user-1',
          iss: ISSUER,
          iat: nowSec - 5,
          exp: nowSec + 300,
        };
      },
    };
    const issuer = new TokenExchangeHttpIssuer(
      baseOptions({
        jwks: undefined,
        jwksUri: `${ISSUER}/jwks.json`,
        fetchFn: fetchFn as never,
        crypto: rotatingCrypto,
      }),
    );
    const verified = await issuer.verify(`${b64u({ alg: 'EdDSA' })}.payload.sig`);
    expect(verified.subject).toBe('user-1');
    expect(jwksCalls).toBe(2);
  });

  it('m3 refuses an oversized JWKS document without text()', async () => {
    const textCalls = { count: 0 };
    const big = JSON.stringify({ keys: [{ k: 'x'.repeat(300) }] });
    const fetchFn = stubFetchShape({
      status: 200,
      text: big,
      textCalls,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () => {
              if (sent) return { done: true as const, value: undefined };
              sent = true;
              return { done: false as const, value: Buffer.from(big, 'utf8') };
            },
            releaseLock: () => {},
          };
        },
      },
    });
    const issuer = new TokenExchangeHttpIssuer(
      baseOptions({
        jwks: undefined,
        jwksUri: `${ISSUER}/jwks.json`,
        fetchFn: fetchFn as never,
        maxResponseBytes: 64,
      }),
    );
    await expect(
      issuer.verify('header.payload.sig'),
    ).rejects.toMatchObject({ name: 'SubjectVerificationError' });
    expect(textCalls.count).toBe(0);
  });
});
