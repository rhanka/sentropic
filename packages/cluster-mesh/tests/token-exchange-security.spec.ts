import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  SubjectVerificationError,
  type MintedToken,
  type MintExchangedTokenInput,
  type TokenExchangeIssuer,
  type TokenExchangeRefusalReason,
  type VerifiedSubjectToken,
} from '../src/index.js';
import { FakeTokenIssuer } from './fixtures/fake-token-issuer.js';

const ISSUER = 'https://fake-idp.example.test';
const SUBJECT_AUDIENCE = 'https://mesh.example.test';
const TARGET_AUDIENCE = 'https://remote.example.test';
const WORKLOAD_CLIENT_ID = 'workload-1';
const WORKLOAD_ACTOR_SUB = 'workload-1';

const NOW_MS = 1_700_000_000_000;
const NOW_SEC = NOW_MS / 1000;

function policy(issuer: TokenExchangeIssuer, extra?: Record<string, unknown>) {
  return {
    issuer,
    audiences: [TARGET_AUDIENCE],
    subjectAudience: SUBJECT_AUDIENCE,
    workloadClientId: WORKLOAD_CLIENT_ID,
    workloadActorSub: WORKLOAD_ACTOR_SUB,
    environment: 'test',
    nowMs: () => NOW_MS,
    ...extra,
  };
}

function setup() {
  const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => NOW_MS });
  const client = createTokenExchangeClient(policy(fake));
  return { fake, client };
}

function baseRequest(subjectToken: string) {
  return {
    grantType: RFC8693_GRANT_TYPE,
    subjectToken,
    subjectTokenType: ACCESS_TOKEN_TYPE,
    audience: TARGET_AUDIENCE,
    scope: [] as readonly string[],
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

const SUBJECT: VerifiedSubjectToken = {
  issuer: ISSUER,
  subject: 'user-1',
  audience: [SUBJECT_AUDIENCE],
  issuedAtSec: NOW_SEC - 60,
  expiresAtSec: NOW_SEC + 3600,
  scope: ['workspace:read'],
};

function verifiedMint(input: MintExchangedTokenInput, overrides?: Partial<MintedToken['verified']>): MintedToken {
  return {
    accessToken: `stub-token-${input.nowSec}-${Math.random().toString(36).slice(2)}`,
    expiresAtSec: input.nowSec + input.ttlSec,
    scope: [...input.scope],
    verified: {
      issuer: ISSUER,
      subject: input.subject.subject,
      audience: input.audience,
      clientId: WORKLOAD_CLIENT_ID,
      actorSub: WORKLOAD_ACTOR_SUB,
      scope: [...input.scope],
      issuedAtSec: input.nowSec,
      expiresAtSec: input.nowSec + input.ttlSec,
      ...overrides,
    },
  };
}

function stubIssuer(overrides: Partial<TokenExchangeIssuer>): TokenExchangeIssuer {
  return {
    verify: async () => SUBJECT,
    mint: async (input: MintExchangedTokenInput) => verifiedMint(input),
    ...overrides,
  };
}

describe('token exchange refusals', () => {
  it.each([
    ['wrong grant type', { grantType: 'urn:ietf:params:oauth:grant-type:jwt-bearer' }, 'grant_type_unsupported'],
    ['wrong subject token type', { subjectTokenType: 'urn:ietf:params:oauth:token-type:id_token' }, 'subject_token_type_unsupported'],
    ['unsupported requested token type', { requestedTokenType: 'urn:ietf:params:oauth:token-type:refresh_token' }, 'requested_token_type_unsupported'],
    ['empty subject token', { subjectToken: '' }, 'subject_token_missing'],
    ['empty audience', { audience: '' }, 'audience_missing'],
  ] as const)('should refuse %s', async (_name, patch, reason) => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(refusalReason(client.exchange({ ...baseRequest(subjectToken), ...patch }))).resolves.toBe(reason);
  });

  it('should refuse an audience outside the allowlist', async () => {
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => NOW_MS });
    const client = createTokenExchangeClient(policy(fake, { audiences: ['https://allowed.example.test'] }));
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(refusalReason(client.exchange(baseRequest(subjectToken)))).resolves.toBe('audience_not_allowed');
  });

  it('should throw at construction without a target allowlist', () => {
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => NOW_MS });

    expect(() => createTokenExchangeClient(policy(fake, { audiences: [] }))).toThrow(TypeError);
    expect(() => createTokenExchangeClient(policy(fake, { audiences: undefined }))).toThrow(TypeError);
  });
});
