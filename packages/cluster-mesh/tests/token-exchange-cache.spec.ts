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

  it('should isolate entries across environments and policy revisions', async () => {
    const now = 1_700_000_000_000;
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now });
    const firstEnv = createTokenExchangeClient({
      issuer: fake,
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'preprod',
      nowMs: () => now,
    });
    const secondEnv = createTokenExchangeClient({
      issuer: fake,
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'prod',
      policyRevision: 'rev-2',
      nowMs: () => now,
    });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const first = await firstEnv.exchange(baseRequest(subjectToken));
    const second = await secondEnv.exchange(baseRequest(subjectToken));

    expect(first.accessToken).not.toBe(second.accessToken);
    expect(fake.mintCalls).toBe(2);
  });

  it('should bound the cache and evict the oldest entry past capacity', async () => {
    const { fake, client } = setup(undefined, { maxEntries: 2 });
    const tokens = await Promise.all(
      ['user-1', 'user-2', 'user-3'].map((subject) =>
        fake.issueSubject({ subject, scope: ['workspace:read'] }),
      ),
    );

    await client.exchange(baseRequest(tokens[0]));
    await client.exchange(baseRequest(tokens[1]));
    expect(client.readTokenExchangeCacheStats().entries).toBe(2);
    await client.exchange(baseRequest(tokens[2]));
    expect(client.readTokenExchangeCacheStats().entries).toBe(2);
    await client.exchange(baseRequest(tokens[0]));

    expect(fake.mintCalls).toBe(4);
  });

  it('should single-flight identical concurrent exchanges', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });
    const request = baseRequest(subjectToken);

    const [first, second] = await Promise.all([client.exchange(request), client.exchange(request)]);

    expect(second.accessToken).toBe(first.accessToken);
    expect(fake.mintCalls).toBe(1);
  });

  it('should evict every matching entry on subject invalidation', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });
    const request = baseRequest(subjectToken);

    const first = await client.exchange(request);
    expect(client.invalidateTokenExchangeCache({ subject: 'user-1' })).toBe(1);
    const second = await client.exchange(request);

    expect(second.accessToken).not.toBe(first.accessToken);
    expect(fake.mintCalls).toBe(2);
  });

  it('should resolve residency as min(minted exp, subject exp, insertedAt + 60s) minus margin', () => {
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_010_000, subjectExpiresAtSec: 1_700_010_000, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_000_000 + TOKEN_EXCHANGE_CACHE_TTL_MS);
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_000_030, subjectExpiresAtSec: 1_700_010_000, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_030_000);
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_010_000, subjectExpiresAtSec: 1_700_000_045, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_045_000);
    expect(
      resolveTokenExchangeCacheTtlMs({
        mintedExpiresAtSec: 1_700_010_000,
        subjectExpiresAtSec: 1_700_010_000,
        insertedAtMs: 1_700_000_000_000,
        marginMs: 5_000,
      }),
    ).toBe(1_700_000_000_000 + TOKEN_EXCHANGE_CACHE_TTL_MS - 5_000);
  });

  it('should build a stable key sensitive to every identity and policy field', () => {
    const request = baseRequest('opaque');
    const subject = {
      issuer: ISSUER,
      subject: 'user-1',
      audience: [SUBJECT_AUDIENCE],
      issuedAtSec: 1,
      expiresAtSec: 2,
      scope: ['y', 'x'],
      clientId: 'public-client',
      tenantId: 'tenant-a',
      jti: 'jti-1',
    };
    const identity = {
      subjectTokenFingerprint: 'fp-1',
      originClientId: 'public-client',
      workloadClientId: WORKLOAD_CLIENT_ID,
      environment: 'test',
      tenantId: 'tenant-a',
      policyRevision: 'rev-1',
    };
    const key = buildTokenExchangeCacheKey(request, subject, identity);

    expect(typeof key).toBe('string');
    expect(buildTokenExchangeCacheKey(request, subject, identity)).toBe(key);
    const variants = [
      buildTokenExchangeCacheKey({ ...request, scope: ['other'] }, subject, identity),
      buildTokenExchangeCacheKey({ ...request, audience: 'https://other.example.test' }, subject, identity),
      buildTokenExchangeCacheKey(request, { ...subject, subject: 'user-2' }, identity),
      buildTokenExchangeCacheKey(request, { ...subject, jti: 'jti-2' }, identity),
      buildTokenExchangeCacheKey(request, subject, { ...identity, subjectTokenFingerprint: 'fp-2' }),
      buildTokenExchangeCacheKey(request, subject, { ...identity, originClientId: 'other-client' }),
      buildTokenExchangeCacheKey(request, subject, { ...identity, workloadClientId: 'other-workload' }),
      buildTokenExchangeCacheKey(request, subject, { ...identity, environment: 'prod' }),
      buildTokenExchangeCacheKey(request, subject, { ...identity, tenantId: 'tenant-b' }),
      buildTokenExchangeCacheKey(request, subject, { ...identity, policyRevision: 'rev-2' }),
    ];
    for (const variant of variants) expect(variant).not.toBe(key);
    expect(buildTokenExchangeCacheKey({ ...request, scope: ['x', 'y'] }, subject, identity)).toBe(
      buildTokenExchangeCacheKey({ ...request, scope: ['y', 'x'] }, subject, identity),
    );
  });
});
