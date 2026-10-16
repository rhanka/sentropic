import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  buildTokenExchangeCacheKey,
  createTokenExchangeClient,
  fingerprintTokenExchangeSubject,
  RFC8693_GRANT_TYPE,
  resolveTokenExchangeCacheTtlMs,
  TOKEN_EXCHANGE_CACHE_TTL_MS,
  type TokenExchangeIssuer,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';
const SUBJECT_AUDIENCE = 'https://mesh.example.test';
const TARGET_AUDIENCE = 'https://remote.example.test';
const WORKLOAD_CLIENT_ID = 'workload-1';
const WORKLOAD_ACTOR_SUB = 'workload-1';

function setup(issuer?: TokenExchangeIssuer, extra?: Record<string, unknown>) {
  let now = 1_700_000_000_000;
  const fake = issuer ?? new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now });
  const client = createTokenExchangeClient({
    issuer: fake,
    audiences: [TARGET_AUDIENCE, 'https://other.example.test'],
    subjectAudience: SUBJECT_AUDIENCE,
    workloadClientId: WORKLOAD_CLIENT_ID,
    workloadActorSub: WORKLOAD_ACTOR_SUB,
    environment: 'test',
    nowMs: () => now,
    ...extra,
  });
  return { fake: fake as FakeTokenIssuer, client, advance: (ms: number) => { now += ms; } };
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

describe('token exchange cache', () => {
  it('should cap residency at 60s even for long-lived tokens', async () => {
    const { fake, client, advance } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 3600 });

    const first = await client.exchange(baseRequest(subjectToken));
    advance(TOKEN_EXCHANGE_CACHE_TTL_MS + 1);
    const second = await client.exchange(baseRequest(subjectToken));

    expect(second.accessToken).not.toBe(first.accessToken);
    expect(fake.mintCalls).toBe(2);
  });

  it('should evict when the minted token expires first', async () => {
    const { fake, client, advance } = setup(undefined, { maxTtlSec: 30 });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 3600 });

    const request = baseRequest(subjectToken);
    const first = await client.exchange(request);
    expect(first.expiresIn).toBeLessThanOrEqual(30);
    advance(31_000);
    await client.exchange(request);

    expect(fake.mintCalls).toBe(2);
  });

  it('should never serve an entry past subject expiry', async () => {
    const { fake, client, advance } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 120 });

    await client.exchange(baseRequest(subjectToken));
    advance(121_000);

    await expect(client.exchange(baseRequest(subjectToken))).rejects.toMatchObject({
      code: 'token_exchange_refused',
      reason: 'subject_expired',
    });
    expect(fake.mintCalls).toBe(1);
  });

  it('should isolate cache entries across audiences and scopes', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['a', 'b'] });
    const request = { ...baseRequest(subjectToken), scope: ['a'] as readonly string[] };

    const byAudience = await client.exchange({ ...request, audience: 'https://other.example.test' });
    const byScope = await client.exchange({ ...request, scope: ['b'] });

    expect(byAudience.accessToken).not.toBe(byScope.accessToken);
    expect(fake.mintCalls).toBe(2);
  });

  it('should isolate entries across distinct subject tokens of the same user', async () => {
    const { fake, client } = setup();
    const firstToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });
    const secondToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const first = await client.exchange(baseRequest(firstToken));
    const second = await client.exchange(baseRequest(secondToken));

    expect(first.accessToken).not.toBe(second.accessToken);
    expect(fingerprintTokenExchangeSubject(firstToken)).not.toBe(fingerprintTokenExchangeSubject(secondToken));
    expect(fake.mintCalls).toBe(2);
  });

  it('should isolate entries across tenants and originating clients', async () => {
    const { fake, client } = setup();
    const plain = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });
    const tenant = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], tenantId: 'tenant-b' });
    const originClient = await fake.issueSubject({
      subject: 'user-1',
      scope: ['workspace:read'],
      clientId: 'public-client-2',
    });

    const plainResponse = await client.exchange(baseRequest(plain));
    const tenantResponse = await client.exchange(baseRequest(tenant));
    const clientResponse = await client.exchange(baseRequest(originClient));

    expect(new Set([plainResponse.accessToken, tenantResponse.accessToken, clientResponse.accessToken]).size).toBe(3);
    expect(fake.mintCalls).toBe(3);
  });
});
