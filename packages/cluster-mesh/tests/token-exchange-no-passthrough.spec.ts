import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  type MintExchangedTokenInput,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';

function setup() {
  const now = 1_700_000_000_000;
  const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now });
  const client = createTokenExchangeClient({ issuer: fake, nowMs: () => now });
  return { fake, client };
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

describe('token exchange never-passthrough', () => {
  it('should never return the subject token as the access token, even on mint echo', async () => {
    const { fake } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });
    const client = createTokenExchangeClient({
      issuer: {
        verify: (token: string) => fake.verify(token),
        mint: async (input: MintExchangedTokenInput) => ({
          accessToken: subjectToken,
          expiresAtSec: input.nowSec + 60,
          scope: [],
        }),
      },
      nowMs: () => 1_700_000_000_000,
    });

    const error = await client.exchange(baseRequest(subjectToken)).then(
      () => { throw new Error('exchange unexpectedly succeeded'); },
      (rejection: unknown) => rejection,
    );
    expect(error).toMatchObject({ code: 'token_exchange_refused', reason: 'mint_passthrough' });
  });

  it('should attach no token material to refusal errors', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const error = await client
      .exchange({ ...baseRequest(subjectToken), scope: ['workspace:admin'] })
      .then(
        () => { throw new Error('exchange unexpectedly succeeded'); },
        (rejection: unknown) => rejection,
      );

    expect(error).toMatchObject({ code: 'token_exchange_refused', reason: 'scope_not_granted' });
    expect(JSON.stringify(error)).not.toContain(subjectToken);
    expect(String((error as Error).message)).not.toContain(subjectToken);
  });

  it('should perform no retry with the original Bearer credential after issuer failure', async () => {
    let verifyCalls = 0;
    const client = createTokenExchangeClient({
      issuer: {
        verify: async () => {
          verifyCalls += 1;
          throw new Error('idp unreachable');
        },
        mint: async () => {
          throw new Error('mint must never run after verify failure');
        },
      },
      nowMs: () => 1_700_000_000_000,
    });

    await expect(client.exchange(baseRequest('original-Bearer'))).rejects.toMatchObject({
      code: 'token_exchange_refused',
      reason: 'subject_unverified',
    });
    expect(verifyCalls).toBe(1);
  });

  it('should not fall back to a cached entry when the request policy differs', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    const first = await client.exchange(baseRequest(subjectToken));
    await expect(
      client.exchange({ ...baseRequest(subjectToken), scope: ['workspace:admin'] }),
    ).rejects.toMatchObject({ code: 'token_exchange_refused', reason: 'scope_not_granted' });
    expect(fake.mintCalls).toBe(1);
    void first;
  });
});
