import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  type MintExchangedTokenInput,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';
const SUBJECT_AUDIENCE = 'https://mesh.example.test';
const TARGET_AUDIENCE = 'https://remote.example.test';
const WORKLOAD_CLIENT_ID = 'workload-1';
const WORKLOAD_ACTOR_SUB = 'workload-1';

function setup() {
  const now = 1_700_000_000_000;
  const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => now });
  const client = createTokenExchangeClient({
    issuer: fake,
    audiences: [TARGET_AUDIENCE],
    subjectAudience: SUBJECT_AUDIENCE,
    workloadClientId: WORKLOAD_CLIENT_ID,
    workloadActorSub: WORKLOAD_ACTOR_SUB,
    environment: 'test',
    nowMs: () => now,
  });
  return { fake, client };
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

describe('token exchange never-passthrough', () => {
  it('should never return the subject token as the access token, even on mint echo', async () => {
    const { fake } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });
    const client = createTokenExchangeClient({
      issuer: {
        verify: (token: string) => fake.verify(token),
        mint: async (input: MintExchangedTokenInput) => ({
          accessToken: subjectToken,
          expiresAtSec: input.nowSec + 60,
          scope: [...input.scope],
          verified: {
            issuer: ISSUER,
            subject: input.subject.subject,
            audience: input.audience,
            clientId: input.workloadClientId,
            actorSub: input.actorSub,
            scope: [...input.scope],
            issuedAtSec: input.nowSec,
            expiresAtSec: input.nowSec + 60,
          },
        }),
      },
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'test',
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

  it('should perform no retry with the original Bearer [REDACTED] after issuer failure', async () => {
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
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'test',
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

  it('should never serve an expired entry, even when the issuer stays down', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: 3600 });

    await client.exchange(baseRequest(subjectToken));
    const downClient = createTokenExchangeClient({
      issuer: {
        verify: (token: string) => fake.verify(token),
        mint: async () => { throw new Error('issuer down'); },
      },
      audiences: [TARGET_AUDIENCE],
      subjectAudience: SUBJECT_AUDIENCE,
      workloadClientId: WORKLOAD_CLIENT_ID,
      workloadActorSub: WORKLOAD_ACTOR_SUB,
      environment: 'test',
      nowMs: () => 1_700_000_000_000 + 61_000,
    });

    await expect(downClient.exchange(baseRequest(subjectToken))).rejects.toMatchObject({
      code: 'token_exchange_refused',
    });
  });
});
