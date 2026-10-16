import { jwtVerify } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';
const SECRET = 'lot-2a-test-only-secret';

function setup() {
  let now = 1_700_000_000_000;
  const fake = new FakeTokenIssuer({ issuer: ISSUER, secret: SECRET, nowMs: () => now });
  const client = createTokenExchangeClient({ issuer: fake, nowMs: () => now });
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
    audience: 'https://remote.example.test',
    scope: ['workspace:read'] as readonly string[],
  };
}

describe('token exchange client', () => {
  it('should exchange a valid subject token for a Bearer access token', async () => {
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
    expect(verified.payload.aud).toBe('https://remote.example.test');
  });

  it('should grant the subject scope when no scope is requested', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const response = await client.exchange({ ...baseRequest(subjectToken), scope: [] });

    expect(response.scope).toEqual(['workspace:read']);
  });

  it('should cap minted TTL at the configured ceiling', async () => {
    const { fake } = setup();
    const client = createTokenExchangeClient({ issuer: fake, maxTtlSec: 120, nowMs: () => 1_700_000_000_000 });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [], expiresInSec: 3600 });

    const response = await client.exchange({ ...baseRequest(subjectToken), scope: [] });

    expect(response.expiresIn).toBeLessThanOrEqual(120);
  });

  it('should propagate a validated actor binding into the minted token', async () => {
    const { fake, client, verifyMinted } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });

    const response = await client.exchange({
      ...baseRequest(subjectToken),
      scope: [],
      actor: { sub: 'agent-1', iss: ISSUER, h2aEngagement: 'engagement:opaque' },
    });

    const verified = await verifyMinted(response.accessToken);
    expect(verified.payload.act).toEqual({ sub: 'agent-1', iss: ISSUER });
  });

  it('should serve a repeated request from the mandatory cache without re-minting', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });

    const first = await client.exchange({ ...baseRequest(subjectToken), scope: [] });
    const second = await client.exchange({ ...baseRequest(subjectToken), scope: [] });

    expect(second.accessToken).toBe(first.accessToken);
    expect(fake.mintCalls).toBe(1);
  });
});
