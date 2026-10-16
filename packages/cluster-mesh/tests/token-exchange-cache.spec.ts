import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  buildTokenExchangeCacheKey,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  resolveTokenExchangeCacheTtlMs,
  TOKEN_EXCHANGE_CACHE_TTL_MS,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';

function setup() {
  let now = 1_700_000_000_000;
  const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now });
  const client = createTokenExchangeClient({ issuer: fake, nowMs: () => now });
  return { fake, client, advance: (ms: number) => { now += ms; } };
}

function baseRequest(subjectToken: string) {
  return {
    grantType: RFC8693_GRANT_TYPE,
    subjectToken,
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: 'https://remote.example.test',
    scope: [] as readonly string[],
  };
}

describe('token exchange cache', () => {
  it('should cap residency at 60s even for long-lived tokens', async () => {
    const { fake, client, advance } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [], expiresInSec: 3600 });

    const first = await client.exchange(baseRequest(subjectToken));
    advance(TOKEN_EXCHANGE_CACHE_TTL_MS + 1);
    const second = await client.exchange(baseRequest(subjectToken));

    expect(second.accessToken).not.toBe(first.accessToken);
    expect(fake.mintCalls).toBe(2);
  });

  it('should evict when the minted token expires first', async () => {
    const now = { value: 1_700_000_000_000 };
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now.value });
    const shortClient = createTokenExchangeClient({ issuer: fake, maxTtlSec: 30, nowMs: () => now.value });
    const advance = (ms: number) => { now.value += ms; };
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [], expiresInSec: 3600 });

    const request = baseRequest(subjectToken);
    const first = await shortClient.exchange(request);
    expect(first.expiresIn).toBeLessThanOrEqual(30);
    advance(31_000);
    await shortClient.exchange(request);

    expect(fake.mintCalls).toBe(2);
  });

  it('should never serve an entry past subject expiry', async () => {
    const { fake, client, advance } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [], expiresInSec: 120 });

    await client.exchange(baseRequest(subjectToken));
    advance(121_000);

    await expect(client.exchange(baseRequest(subjectToken))).rejects.toMatchObject({
      code: 'token_exchange_refused',
      reason: 'subject_expired',
    });
    expect(fake.mintCalls).toBe(1);
  });

  it('should isolate cache entries across audiences, scopes and actors', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['a', 'b'] });
    const request = baseRequest(subjectToken);

    const byAudience = await client.exchange({ ...request, audience: 'https://other.example.test', scope: ['a'] });
    const byScope = await client.exchange({ ...request, scope: ['b'] });
    const byActor = await client.exchange({
      ...request,
      scope: ['a'],
      actor: { sub: 'agent-1', iss: ISSUER, h2aEngagement: 'engagement:1' },
    });

    expect(new Set([byAudience.accessToken, byScope.accessToken, byActor.accessToken]).size).toBe(3);
    expect(fake.mintCalls).toBe(3);
  });

  it('should resolve residency as min(minted exp, subject exp, insertedAt + 60s)', () => {
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_010_000, subjectExpiresAtSec: 1_700_010_000, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_000_000 + TOKEN_EXCHANGE_CACHE_TTL_MS);
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_000_030, subjectExpiresAtSec: 1_700_010_000, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_030_000);
    expect(
      resolveTokenExchangeCacheTtlMs({ mintedExpiresAtSec: 1_700_010_000, subjectExpiresAtSec: 1_700_000_045, insertedAtMs: 1_700_000_000_000 }),
    ).toBe(1_700_000_045_000);
  });

  it('should build a 12-field key that separates policy from identity', () => {
    const request = baseRequest('opaque');
    const subject = {
      issuer: ISSUER,
      subject: 'user-1',
      audience: ['b', 'a'],
      issuedAtSec: 1,
      expiresAtSec: 2,
      scope: ['y', 'x'],
    };
    const key = buildTokenExchangeCacheKey(request, subject);

    expect(key).toHaveLength(12);
    expect(key[4]).toBe('');
    expect(key[10]).toBe('a b');
    expect(key[11]).toBe('x y');
  });
});
