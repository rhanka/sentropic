import { describe, expect, it } from 'vitest';
import {
  ACCESS_TOKEN_TYPE,
  createTokenExchangeClient,
  RFC8693_GRANT_TYPE,
  SubjectVerificationError,
  type MintExchangedTokenInput,
  type TokenExchangeIssuer,
  type TokenExchangeRefusalReason,
  type VerifiedSubjectToken,
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
  audience: ['https://mesh.example.test'],
  issuedAtSec: 1_700_000_000,
  expiresAtSec: 1_700_003_600,
  scope: ['workspace:read'],
};

function stubIssuer(overrides: Partial<TokenExchangeIssuer>): TokenExchangeIssuer {
  return {
    verify: async () => SUBJECT,
    mint: async (input: MintExchangedTokenInput) => ({
      accessToken: `stub-token-${input.nowSec}`,
      expiresAtSec: input.nowSec + input.ttlSec,
      scope: [...input.scope],
    }),
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
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });

    await expect(refusalReason(client.exchange({ ...baseRequest(subjectToken), ...patch }))).resolves.toBe(reason);
  });

  it('should refuse an audience outside the allowlist', async () => {
    const { fake } = setup();
    const client = createTokenExchangeClient({
      issuer: fake,
      audiences: ['https://allowed.example.test'],
      nowMs: () => 1_700_000_000_000,
    });
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });

    await expect(refusalReason(client.exchange(baseRequest(subjectToken)))).resolves.toBe('audience_not_allowed');
  });

  it.each([
    ['forged signature', async (fake: FakeTokenIssuer) => `${await fake.issueSubject({ subject: 'user-1' })}x`],
    ['wrong issuer', async (fake: FakeTokenIssuer) => fake.issueSubject({ subject: 'user-1', issuer: 'https://evil.example.test' })],
    ['malformed token', async () => 'not-a-jwt'],
  ])('should refuse an unverifiable subject token (%s)', async (_name, makeToken) => {
    const { fake, client } = setup();

    await expect(refusalReason(client.exchange(baseRequest(await makeToken(fake))))).resolves.toBe('subject_unverified');
  });

  it('should refuse an expired subject token without calling mint', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [], expiresInSec: -10 });

    await expect(refusalReason(client.exchange(baseRequest(subjectToken)))).resolves.toBe('subject_expired');
    expect(fake.mintCalls).toBe(0);
  });

  it('should refuse when the binding reports an unexpected verification failure', async () => {
    const client = createTokenExchangeClient({
      issuer: stubIssuer({ verify: async () => { throw new Error('idp unreachable'); } }),
      nowMs: () => 1_700_000_000_000,
    });

    await expect(refusalReason(client.exchange(baseRequest('opaque')))).resolves.toBe('subject_unverified');
  });

  it('should refuse when verification reports expiry directly', async () => {
    const client = createTokenExchangeClient({
      issuer: stubIssuer({ verify: async () => { throw new SubjectVerificationError('expired'); } }),
      nowMs: () => 1_700_000_000_000,
    });

    await expect(refusalReason(client.exchange(baseRequest('opaque')))).resolves.toBe('subject_expired');
  });

  it.each([
    ['empty actor sub', { sub: '', iss: ISSUER, h2aEngagement: 'engagement:1' }],
    ['empty actor issuer', { sub: 'agent-1', iss: '', h2aEngagement: 'engagement:1' }],
    ['empty engagement reference', { sub: 'agent-1', iss: ISSUER, h2aEngagement: '' }],
    ['actor issuer bound to another issuer', { sub: 'agent-1', iss: 'https://other.example.test', h2aEngagement: 'engagement:1' }],
  ])('should refuse an invalid actor (%s)', async (_name, actor) => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: [] });

    await expect(refusalReason(client.exchange({ ...baseRequest(subjectToken), actor }))).resolves.toBe('actor_invalid');
    expect(fake.mintCalls).toBe(0);
  });

  it('should refuse a scope outside the subject grant', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(
      refusalReason(client.exchange({ ...baseRequest(subjectToken), scope: ['workspace:admin'] })),
    ).resolves.toBe('scope_not_granted');
    expect(fake.mintCalls).toBe(0);
  });

  it('should refuse when mint echoes the subject token back', async () => {
    const client = createTokenExchangeClient({
      issuer: stubIssuer({ mint: async (input) => ({ accessToken: 'echoed-subject', expiresAtSec: input.nowSec + 60, scope: [] }) }),
      nowMs: () => 1_700_000_000_000,
    });

    await expect(refusalReason(client.exchange({ ...baseRequest('echoed-subject'), scope: ['workspace:read'] }))).resolves.toBe(
      'mint_passthrough',
    );
  });

  it('should refuse when mint smuggles refresh material', async () => {
    const client = createTokenExchangeClient({
      issuer: stubIssuer({
        mint: async (input: MintExchangedTokenInput) => ({
          accessToken: 'minted-with-refresh',
          expiresAtSec: input.nowSec + 60,
          scope: [],
          refreshToken: 'refresh-smuggle',
        }) as never,
      }),
      nowMs: () => 1_700_000_000_000,
    });

    await expect(refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] }))).resolves.toBe(
      'mint_refresh_present',
    );
  });

  it('should refuse when mint produces an already-expired token', async () => {
    const client = createTokenExchangeClient({
      issuer: stubIssuer({ mint: async (input) => ({ accessToken: 'stale-mint', expiresAtSec: input.nowSec, scope: [] }) }),
      nowMs: () => 1_700_000_000_000,
    });

    await expect(refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] }))).resolves.toBe(
      'ttl_non_positive',
    );
  });
});
