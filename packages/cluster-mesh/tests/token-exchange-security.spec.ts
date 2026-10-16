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

  it.each([
    ['forged signature', async (fake: FakeTokenIssuer) => `${await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] })}x`],
    ['wrong issuer', async (fake: FakeTokenIssuer) => fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], issuer: 'https://evil.example.test' })],
    ['malformed token', async () => 'not-a-jwt'],
  ])('should refuse an unverifiable subject token (%s)', async (_name, makeToken) => {
    const { fake, client } = setup();

    await expect(
      refusalReason(client.exchange({ ...baseRequest(await makeToken(fake)), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_unverified');
  });

  it('should refuse a subject whose audience is not the configured one', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ verify: async () => ({ ...SUBJECT, audience: ['https://other.example.test'] }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_audience_invalid');
  });

  it('should refuse a subject carrying several audiences', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ verify: async () => ({ ...SUBJECT, audience: [SUBJECT_AUDIENCE, 'https://other.example.test'] }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_audience_invalid');
  });

  it('should refuse an expired subject token without calling mint', async () => {
    const { fake, client } = setup();
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'], expiresInSec: -10 });

    await expect(
      refusalReason(client.exchange({ ...baseRequest(subjectToken), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_expired');
    expect(fake.mintCalls).toBe(0);
  });

  it('should refuse when the binding reports an unexpected verification failure', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ verify: async () => { throw new Error('idp unreachable'); } })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_unverified');
  });

  it('should refuse when verification reports expiry directly', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ verify: async () => { throw new SubjectVerificationError('expired'); } })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('subject_expired');
  });

  it('should refuse an empty requested scope without calling mint', async () => {
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => NOW_MS });
    const client = createTokenExchangeClient(policy(fake));
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(refusalReason(client.exchange(baseRequest(subjectToken)))).resolves.toBe('scope_empty');
    expect(fake.mintCalls).toBe(0);
  });

  it('should refuse any caller-supplied actor without calling mint', async () => {
    const fake = new FakeTokenIssuer({ issuer: ISSUER, nowMs: () => NOW_MS });
    const client = createTokenExchangeClient(policy(fake));
    const subjectToken = await fake.issueSubject({ subject: 'user-1', scope: ['workspace:read'] });

    await expect(
      refusalReason(
        client.exchange({
          ...baseRequest(subjectToken),
          scope: ['workspace:read'],
          actor: { sub: 'agent-1', iss: ISSUER, h2aEngagement: 'engagement:1' },
        }),
      ),
    ).resolves.toBe('actor_invalid');
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

  it('should refuse a minted scope wider than the granted scope', async () => {
    const client = createTokenExchangeClient(
      policy(
        stubIssuer({
          mint: async (input) => verifiedMint(input, { scope: [...input.scope, 'workspace:admin'] }),
        }),
      ),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_scope_invalid');
  });

  it('should refuse a minted token with the wrong audience', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { audience: 'https://evil.example.test' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_audience_invalid');
  });

  it('should refuse a minted token with the wrong subject', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { subject: 'user-2' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_subject_invalid');
  });

  it('should refuse a minted token without the workload actor', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { actorSub: 'agent-1' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_actor_invalid');
  });

  it('should refuse a minted token with the wrong workload client', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { clientId: 'other-client' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_actor_invalid');
  });

  it('should refuse a minted token from the wrong issuer', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { issuer: 'https://evil.example.test' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_issuer_invalid');
  });

  it('should refuse a minted token living past the subject expiry', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { expiresAtSec: SUBJECT.expiresAtSec + 60 }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_ttl_invalid');
  });

  it('should refuse a minted token living past the 300-second ceiling', async () => {
    const client = createTokenExchangeClient(
      policy(
        stubIssuer({
          verify: async () => ({ ...SUBJECT, expiresAtSec: NOW_SEC + 3600 }),
          mint: async (input) => verifiedMint(input, { expiresAtSec: input.nowSec + 301 }),
        }),
      ),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_ttl_invalid');
  });

  it('should refuse a non-Bearer minted token type', async () => {
    const client = createTokenExchangeClient(
      policy(
        stubIssuer({
          mint: async (input) => ({ ...verifiedMint(input), tokenType: 'DPoP' }) as unknown as MintedToken,
        }),
      ),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('minted_token_type_unsupported');
  });

  it('should refuse when mint echoes the subject token back', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => ({ ...verifiedMint(input), accessToken: 'echoed-subject' }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('echoed-subject'), scope: ['workspace:read'] })),
    ).resolves.toBe('mint_passthrough');
  });

  it('should refuse when mint smuggles refresh material', async () => {
    const client = createTokenExchangeClient(
      policy(
        stubIssuer({
          mint: async (input: MintExchangedTokenInput) => ({
            ...verifiedMint(input),
            refreshToken: 'refresh-smuggle',
          }) as never,
        }),
      ),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('mint_refresh_present');
  });

  it('should refuse with mint_failed when the issuer call fails', async () => {
    const client = createTokenExchangeClient(
      policy(
        stubIssuer({
          mint: async () => {
            throw new Error('network down');
          },
        }),
      ),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('mint_failed');
  });

  it('should refuse when mint produces an already-expired token', async () => {
    const client = createTokenExchangeClient(
      policy(stubIssuer({ mint: async (input) => verifiedMint(input, { expiresAtSec: input.nowSec }) })),
    );

    await expect(
      refusalReason(client.exchange({ ...baseRequest('opaque'), scope: ['workspace:read'] })),
    ).resolves.toBe('ttl_non_positive');
  });
});
