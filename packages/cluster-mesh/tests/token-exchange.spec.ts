import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  type TokenExchangeRefusalReason,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';
const SECRET = 'lot-2a-test-only-secret';
const SUBJECT_AUDIENCE = 'https://mesh.example.test';
const TARGET_AUDIENCE = 'https://remote.example.test';
const WORKLOAD_CLIENT_ID = 'workload-1';
const WORKLOAD_ACTOR_SUB = 'workload-1';

function setup() {
  let now = 1_700_000_000_000;
  const fake = new FakeTokenIssuer({ issuer: ISSUER, secret: SECRET, nowMs: () => now });
  const client = createTokenExchangeClient({
    issuer: fake,
    audiences: [TARGET_AUDIENCE],
    subjectAudience: SUBJECT_AUDIENCE,
    workloadClientId: WORKLOAD_CLIENT_ID,
    workloadActorSub: WORKLOAD_ACTOR_SUB,
    environment: 'test',
    nowMs: () => now,
  });
  const key = new TextEncoder().encode(SECRET);
  const verifyMinted = (token: string) =>
    jwtVerify(token, key, { issuer: ISSUER, currentDate: new Date(now) });
  return { fake, client, verifyMinted, advance: (ms: number) => { now += ms; } };
}

function baseRequest(subjectToken: string) {
  return {
    grantType: RFC8693_GRANT_TYPE,
    subjectToken,
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: TARGET_AUDIENCE,
    scope: ['workspace:read'] as readonly string[],
  };
}

async function refusalReason(promise: Promise<unknown>): Promise<TokenExchangeRefusalReason> {
  const error = await promise.then(
    () => { throw new Error('exchange unexpectedly succeeded'); },
    (rejection: unknown) => rejection,
  );
  expect(error).toMatchObject({ code: 'token_exchange_refused' });
  return (error as { reason: TokenExchangeRefusalReason }).reason;
}

describe('token exchange client', () => {
  it('should exchange a valid subject token for a workload-bound Bearer [REDACTED]', async () => {
    const { fake, client, verifyMinted } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read', 'workspace:write'] });

    const response = await client.exchange(baseRequest(subjectToken));

    expect(response.tokenType).toBe('Bearer');
    expect(response.issuedTokenType).toBe(ACCESS_TOKEN_TYPE);
    expect(response.accessToken).not.toBe(subjectToken);
    expect(response.scope).toEqual(['workspace:read']);
    expect(response.expiresIn).toBeGreaterThan(0);
    const verified = await verifyMinted(response.accessToken);
    expect(verified.payload.sub).toBe('user-1');
    expect(verified.payload.aud).toBe(TARGET_AUDIENCE);
    expect(verified.payload.act).toEqual({ sub: WORKLOAD_ACTOR_SUB });
    expect(verified.payload.client_id).toBe(WORKLOAD_CLIENT_ID);
  });

  it('should refuse an empty requested scope instead of widening to the subject grant', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(refusalReason(client.exchange({ ...baseRequest(subjectToken), scope: [] }))).resolves.toBe(
      'scope_empty',
    );
    expect(fake.mintCalls).toBe(0);
  });

  it('should cap minted TTL at the configured ceiling', async () => {
    const now = 1_700_000_000_000;
    const fake = new FakeTokenIssuer({ issuer: ISSUER, secret: SECRET, nowMs: () => now });
    const client = createTokenExchangeClient({
      issuer: fake,
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'test',
      maxTtlSec: 120,
      nowMs: () => now,
    });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 3600 });

    const response = await client.exchange({ ...baseRequest(subjectToken) });

    expect(response.expiresIn).toBeLessThanOrEqual(120);
  });

  it('should never raise the TTL ceiling above 300 seconds', async () => {
    const now = 1_700_000_000_000;
    const fake = new FakeTokenIssuer({ issuer: ISSUER, secret: SECRET, nowMs: () => now });
    const client = createTokenExchangeClient({
      issuer: fake,
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'test',
      maxTtlSec: 600,
      nowMs: () => now,
    });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 3600 });

    const response = await client.exchange({ ...baseRequest(subjectToken) });

    expect(response.expiresIn).toBeLessThanOrEqual(300);
  });

  it('should refuse any caller-supplied actor', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(
      refusalReason(
        client.exchange({
          ...baseRequest(subjectToken),
          actor: { sub: 'agent-1', iss: ISSUER, h2aEngagement: 'engagement:opaque' },
        }),
      ),
    ).resolves.toBe('actor_invalid');
    expect(fake.mintCalls).toBe(0);
  });

  it('should serve a repeated request from the mandatory cache without re-minting', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const first = await client.exchange({ ...baseRequest(subjectToken) });
    const second = await client.exchange({ ...baseRequest(subjectToken) });

    expect(second.accessToken).toBe(first.accessToken);
    expect(fake.mintCalls).toBe(1);
  });

  it('should recompute the remaining lifetime on a cache hit', async () => {
    const { fake, client, advance } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const first = await client.exchange({ ...baseRequest(subjectToken) });
    advance(10_000);
    const second = await client.exchange({ ...baseRequest(subjectToken) });

    expect(second.accessToken).toBe(first.accessToken);
    expect(second.expiresIn).toBeLessThan(first.expiresIn);
    expect(fake.mintCalls).toBe(1);
  });
});
