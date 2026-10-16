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
}

async function refusalReason(promise: Promise<unknown>): Promise<TokenExchangeRefusalReason> {
  const error = await promise.then(
    () => { throw new Error('exchange unexpectedly succeeded'); },
    (rejection: unknown) => rejection,
  );
  expect(error).toMatchObject({ code: 'token_exchange_refused' });
  return (error as { reason: TokenExchangeRefusalReason }).reason;
}
