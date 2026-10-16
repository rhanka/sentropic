import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  TokenExchangeHttpIssuer,
  type TokenExchangeRefusalReason,
} from '../src/index.js';

const SUBJECT_AUDIENCE = 'https://immo-test.example/mcp';
const TARGET_AUDIENCE = 'https://radar-test.example';
const SUBJECT_CLIENT = 'immo-mcp';
const WORKLOAD_CLIENT = 'immo-mcp-workload';
const WORKLOAD_SECRET = 'test-only-workload-secret';
const WORKLOAD_ACTOR = 'immo-mcp-workload';

type Tamper = null | 'scope' | 'audience' | 'actor' | 'ttl' | 'token_type';

/**
 * Faithful in-process double of the #674 issuer token endpoint: exact RFC 8693
 * form contract, `client_secret_basic`, #674 policy checks and `invalid_*`
 * refusals, EdDSA-signed subject and exchanged tokens. Behavior mirrors
 * `packages/auth-hono/src/oauth/token-exchange-handler.ts` at 8c4ff7eda.
 */
class FaithfulIssuerDouble {
  privateKey!: CryptoKey;
  publicJwk!: Record<string, unknown>;
  server!: Server;
  url = '';
  tokenHits = 0;
  lastForm: Record<string, string> | undefined;
  lastAuth: string | undefined;
  tamper: Tamper = null;

  async start(): Promise<void> {
    const pair = await generateKeyPair('EdDSA');
    this.privateKey = pair.privateKey;
    this.publicJwk = (await exportJWK(pair.publicKey)) as Record<string, unknown>;
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'server_error' }));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    const address = this.server.address();
    if (address === null || typeof address === 'string') throw new Error('double failed to bind');
    this.url = `http://127.0.0.1:${address.port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }

  issuer(): string {
    return this.url;
  }

  jwks(): { keys: Record<string, unknown>[] } {
    return { keys: [this.publicJwk] };
  }

  async issueSubject(input: {
    subject: string;
    scope: string;
    audience?: string;
    clientId?: string;
    expiresInSec?: number;
  }): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000);
    return new SignJWT({
      scope: input.scope,
      client_id: input.clientId ?? SUBJECT_CLIENT,
      ...(input.subject === 'tenant-user' ? { tid: 'tenant-a' } : {}),
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer(this.url)
      .setSubject(input.subject)
      .setAudience(input.audience ?? SUBJECT_AUDIENCE)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + (input.expiresInSec ?? 3600))
      .setJti(`subject-${Math.random().toString(36).slice(2)}`)
      .sign(this.privateKey);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const target = new URL(req.url ?? '/', this.url);
    if (req.method === 'GET' && target.pathname === '/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(this.jwks()));
      return;
    }
    if (target.pathname === '/oauth/redirect') {
      res.writeHead(307, { location: `${this.url}/oauth/token` });
      res.end();
      return;
    }
    if (target.pathname === '/oauth/oversized') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ access_token: 'x'.repeat(200_000) }));
      return;
    }
    if (req.method !== 'POST' || target.pathname !== '/oauth/token') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    this.tokenHits += 1;
    this.lastAuth = req.headers.authorization;
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    this.lastForm = Object.fromEntries(form.entries());
    const fail = (status: number, error: string, description: string) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error, error_description: description }));
    };

    if (form.get('grant_type') !== RFC8693_GRANT_TYPE) return fail(400, 'unsupported_grant_type', 'Grant required.');
    const subjectToken = form.get('subject_token') ?? '';
    if (!subjectToken || form.get('subject_token_type') !== ACCESS_TOKEN_TYPE) {
      return fail(400, 'invalid_request', 'A valid subject_token of access_token type is required.');
    }
    const requestedType = form.get('requested_token_type');
    if (requestedType && requestedType !== ACCESS_TOKEN_TYPE) {
      return fail(400, 'invalid_request', 'Only access_token requested_token_type is supported.');
    }
    if (form.get('actor_token') ?? form.get('actor_token_type')) {
      return fail(400, 'invalid_request', 'Delegated actor tokens are not supported.');
    }
    if (req.headers.dpop) return fail(400, 'invalid_request', 'DPoP-bound exchange is not supported.');
    const targets = [...form.getAll('resource'), ...form.getAll('audience')].filter((v) => v.length > 0);
    if (new Set(targets).size > 1 || targets.length === 0) {
      return fail(400, 'invalid_target', 'A single target audience is required.');
    }
    const requestedScopes = (form.get('scope') ?? '').split(/\s+/).filter(Boolean);
    if (requestedScopes.length === 0) return fail(400, 'invalid_scope', 'A non-empty scope is required.');

    const expectedAuth = `Basic ${Buffer.from(`${WORKLOAD_CLIENT}:${WORKLOAD_SECRET}`, 'utf8').toString('base64')}`;
    if (this.lastAuth !== expectedAuth) return fail(401, 'invalid_client', 'Client authentication failed.');
    if (targets[0] !== TARGET_AUDIENCE) return fail(400, 'invalid_target', 'Requested audience is not allowed.');
    const disallowed = requestedScopes.filter((scope) => !['immo:search', 'immo:read'].includes(scope));
    if (disallowed.length > 0) return fail(400, 'invalid_scope', 'Scope not allowed.');

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(subjectToken, createLocalJWKSet(this.jwks()), {
        issuer: this.url,
        currentDate: new Date(),
      });
      payload = verified.payload;
    } catch {
      return fail(400, 'invalid_grant', 'Subject token is invalid or expired.');
    }
    if (payload.act != null) return fail(400, 'invalid_grant', 'Already-exchanged tokens do not qualify.');
    if (payload.cnf != null) return fail(400, 'invalid_grant', 'Proof-bound subject tokens are not supported.');
    if (typeof payload.sub !== 'string' || !payload.sub) {
      return fail(400, 'invalid_grant', 'Subject token has no human subject.');
    }
    if (payload.aud !== SUBJECT_AUDIENCE) return fail(400, 'invalid_grant', 'Subject audience is not allowed.');
    if (payload.client_id !== SUBJECT_CLIENT) return fail(400, 'invalid_grant', 'Subject client is not allowed.');
    if (typeof payload.exp !== 'number' || !(payload.exp * 1000 > Date.now())) {
      return fail(400, 'invalid_grant', 'Subject token is expired.');
    }
    const subjectScopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
    const issued = requestedScopes.filter((scope) => subjectScopes.includes(scope));
    if (issued.length === 0) return fail(400, 'invalid_scope', 'No requested scope is granted to the subject.');

    const nowSec = Math.floor(Date.now() / 1000);
    const ttl = Math.min(300, payload.exp - nowSec);
    const tamperedScopes = this.tamper === 'scope' ? [...issued, 'immo:admin'] : issued;
    const accessToken = await new SignJWT({
      ...(this.tamper === 'actor' ? {} : { act: { sub: WORKLOAD_ACTOR } }),
      client_id: WORKLOAD_CLIENT,
      scope: tamperedScopes.join(' '),
    })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer(this.url)
      .setSubject(payload.sub as string)
      .setAudience(this.tamper === 'audience' ? 'https://evil.example' : TARGET_AUDIENCE)
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + (this.tamper === 'ttl' ? 600 : ttl))
      .setJti(`exchange-${Math.random().toString(36).slice(2)}`)
      .sign(this.privateKey);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        access_token: accessToken,
        expires_in: this.tamper === 'ttl' ? 600 : ttl,
        issued_token_type: ACCESS_TOKEN_TYPE,
        scope: issued.join(' '),
        token_type: this.tamper === 'token_type' ? 'DPoP' : 'Bearer',
      }),
    );
  }
}

async function refusalReason(promise: Promise<unknown>): Promise<TokenExchangeRefusalReason> {
  const error = await promise.then(
    () => { throw new Error('exchange unexpectedly succeeded'); },
    (rejection: unknown) => rejection,
  );
  expect(error).toMatchObject({ code: 'token_exchange_refused' });
  return (error as { reason: TokenExchangeRefusalReason }).reason;
}
function clientFor(double: FaithfulIssuerDouble, secret: string, endpoint?: string) {
  const issuer = new TokenExchangeHttpIssuer({
    tokenEndpoint: endpoint ?? `${double.url}/oauth/token`,
    issuer: double.issuer(),
    jwksUri: `${double.url}/jwks.json`,
    workloadClientId: WORKLOAD_CLIENT,
    clientSecret: secret,
    actorSub: WORKLOAD_ACTOR,
    allowLoopbackHttp: true,
  });
  return createTokenExchangeClient({
    issuer,
    audiences: [TARGET_AUDIENCE],
    subjectAudience: SUBJECT_AUDIENCE,
    workloadClientId: WORKLOAD_CLIENT,
    workloadActorSub: WORKLOAD_ACTOR,
    environment: 'test',
  });
}

function baseRequest(subjectToken: string) {
  return {
    grantType: RFC8693_GRANT_TYPE,
    subjectToken,
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: TARGET_AUDIENCE,
    scope: ['immo:search'] as readonly string[],
  };
}

describe('token exchange integration against the #674 wire contract', () => {
  let double: FaithfulIssuerDouble;

  beforeAll(async () => {
    double = new FaithfulIssuerDouble();
    await double.start();
  });

  afterAll(async () => {
    await double.stop();
  });

  it('should exchange over real HTTP with form, Basic, and a verified workload-bound token', async () => {
    const subjectToken = await double.issueSubject({ subject: 'user-1', scope: 'immo:search immo:read' });
    const client = clientFor(double, WORKLOAD_SECRET);

    const response = await client.exchange(baseRequest(subjectToken));

    expect(response.tokenType).toBe('Bearer');
    expect(response.issuedTokenType).toBe(ACCESS_TOKEN_TYPE);
    expect(response.scope).toEqual(['immo:search']);
    expect(response.expiresIn).toBeGreaterThan(0);
    expect(response.accessToken).not.toBe(subjectToken);
    expect(double.lastForm?.grant_type).toBe(RFC8693_GRANT_TYPE);
    expect(double.lastForm?.subject_token).toBe(subjectToken);
    expect(double.lastForm?.subject_token_type).toBe(ACCESS_TOKEN_TYPE);
    expect(double.lastForm?.scope).toBe('immo:search');
    expect(double.lastForm?.resource).toBe(TARGET_AUDIENCE);
    expect(double.lastAuth).toBe(
      `Basic ${Buffer.from(`${WORKLOAD_CLIENT}:${WORKLOAD_SECRET}`, 'utf8').toString('base64')}`,
    );
  });

  it('should serve a warm repeat without hitting the token endpoint', async () => {
    const subjectToken = await double.issueSubject({ subject: 'user-1', scope: 'immo:search' });
    const client = clientFor(double, WORKLOAD_SECRET);
    const before = double.tokenHits;

    const first = await client.exchange(baseRequest(subjectToken));
    const second = await client.exchange(baseRequest(subjectToken));

    expect(second.accessToken).toBe(first.accessToken);
    expect(double.tokenHits - before).toBe(1);
  });
  it('should refuse a wrong workload secret without leaking it', async () => {
    const subjectToken = await double.issueSubject({ subject: 'user-1', scope: 'immo:search' });
    const client = clientFor(double, 'wrong-secret');

    const error = await client.exchange(baseRequest(subjectToken)).then(
      () => { throw new Error('exchange unexpectedly succeeded'); },
      (rejection: unknown) => rejection,
    );

    expect(error).toMatchObject({ code: 'token_exchange_refused', reason: 'mint_failed' });
    expect(JSON.stringify(error)).not.toContain('wrong-secret');
  });

  it('should map an issuer scope denial to scope_not_granted', async () => {
    const subjectToken = await double.issueSubject({ subject: 'user-1', scope: 'immo:search' });
    const client = clientFor(double, WORKLOAD_SECRET);

    await expect(
      refusalReason(client.exchange({ ...baseRequest(subjectToken), scope: ['immo:documents:read'] })),
    ).resolves.toBe('scope_not_granted');
  });

  it('should map an issuer target denial to audience_not_allowed', async () => {
    const subjectToken = await double.issueSubject({ subject: 'user-1', scope: 'immo:search' });
    const issuer = new TokenExchangeHttpIssuer({
      tokenEndpoint: `${double.url}/oauth/token`,
      issuer: double.issuer(),
      jwksUri: `${double.url}/jwks.json`,
      workloadClientId: WORKLOAD_CLIENT,
      clientSecret: WORKLOAD_SECRET,
      actorSub: WORKLOAD_ACTOR,
      allowLoopbackHttp: true,
    });
    const client = createTokenExchangeClient({
      issuer,
      audiences: [TARGET_AUDIENCE, 'https://other.example'],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT,
      workloadActorSub: WORKLOAD_ACTOR,
      environment: 'test',
    });

    await expect(
      refusalReason(client.exchange({ ...baseRequest(subjectToken), audience: 'https://other.example' })),
    ).resolves.toBe('audience_not_allowed');
  });

  it('should refuse a forged subject without calling the token endpoint', async () => {
    const client = clientFor(double, WORKLOAD_SECRET);
    const before = double.tokenHits;

    await expect(
      refusalReason(client.exchange({ ...baseRequest('forged-token'), scope: ['immo:search'] })),
    ).resolves.toBe('subject_unverified');
    expect(double.tokenHits).toBe(before);
});
});
