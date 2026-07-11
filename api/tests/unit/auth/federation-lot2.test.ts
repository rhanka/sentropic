import {
  AuthHonoIdentityConflictError,
  type AuthHonoCreateFederationFlowStateInput,
  type AuthHonoFederationFlowState,
  type AuthHonoFederationPort,
  type AuthHonoIdentityRecord,
  type AuthHonoLinkIdentityInput,
  type AuthHonoSessionTokens,
  type AuthHonoUserRecord,
} from '@sentropic/auth-hono';
import { describe, expect, it, vi } from 'vitest';

import { createFederationBroker } from '../../../src/services/auth/federation/broker';
import type {
  FederationBrokerDeps,
  FederationProvider,
  FederationProviderIdentity,
} from '../../../src/services/auth/federation/types';

/**
 * BR-39e Lot 2 — GitHub keystones on the shared broker core, tested as a pure unit with in-memory
 * fakes (no DB, no arctic, no network). GitHub is deliberately NOT on the auto-link allowlist (D8),
 * so its email collisions route to the AUTHENTICATED manual-link path, never a silent merge.
 *
 *  - K-GH-SUBJECT     a returning GitHub subject resolves the existing identity → session, no challenge.
 *  - K-GH-NOVERIFIED  a GitHub identity with no verified email → email-challenge outcome, NO user made.
 *  - K-GH-MANUAL      a GitHub verified-email collision → manual-link, never auto-merge (even a shell).
 *  - K-MANUAL-LINK-AUTH  the manual-link callback rejects unauthenticated and links to the session user.
 */

const NOW = new Date('2026-07-11T00:00:00.000Z');

const key = (provider: string, subject: string): string => `${provider}::${subject}`;

const createFakeGithubProvider = (
  options: { identity?: FederationProviderIdentity; verifyThrows?: boolean } = {},
): { provider: FederationProvider; verify: ReturnType<typeof vi.fn> } => {
  const verify = vi.fn(async (): Promise<FederationProviderIdentity> => {
    if (options.verifyThrows) throw new Error('github exchange failed');
    return options.identity ?? { email: 'gh@example.com', emailVerified: true, subject: 'gh-1' };
  });
  const provider: FederationProvider = {
    createAuthorizationUrl({ state }) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('state', state);
      url.searchParams.set('scope', 'read:user user:email');
      return url.toString();
    },
    id: 'github',
    verifyCallback: verify,
  };
  return { provider, verify };
};

const createFakeFederation = () => {
  const identities = new Map<string, AuthHonoIdentityRecord>();
  const flowStates = new Map<string, AuthHonoFederationFlowState>();
  const credentialed = new Set<string>();
  let seq = 0;

  const port: AuthHonoFederationPort = {
    consumeFlowState: async (id, now) => {
      const record = flowStates.get(id);
      if (!record || record.expiresAt <= now) return null;
      flowStates.delete(id);
      return record;
    },
    createFlowState: async (input: AuthHonoCreateFederationFlowStateInput) => {
      const record: AuthHonoFederationFlowState = {
        codeVerifier: input.codeVerifier ?? null,
        continuationToken: input.continuationToken ?? null,
        createdAt: input.now,
        expiresAt: input.expiresAt,
        id: `flow-${(seq += 1)}`,
        nonce: input.nonce ?? null,
        provider: input.provider,
        upstreamState: input.upstreamState,
      };
      flowStates.set(record.id, record);
      return record;
    },
    findIdentitiesForUser: async (userId) =>
      [...identities.values()].filter((identity) => identity.userId === userId),
    findIdentityBySubject: async (provider, subject) => identities.get(key(provider, subject)) ?? null,
    isUserCredentialed: async (userId) => credentialed.has(userId),
    linkIdentity: async (input: AuthHonoLinkIdentityInput) => {
      const composite = key(input.provider, input.providerSubject);
      if (identities.has(composite)) {
        throw new AuthHonoIdentityConflictError(input.provider, input.providerSubject);
      }
      const record: AuthHonoIdentityRecord = {
        emailAtLink: input.emailAtLink,
        emailVerifiedByProvider: input.emailVerifiedByProvider,
        id: `identity-${(seq += 1)}`,
        lastLoginAt: input.now,
        linkedAt: input.now,
        provider: input.provider,
        providerSubject: input.providerSubject,
        providerTenant: input.providerTenant ?? null,
        userId: input.userId,
      };
      identities.set(composite, record);
      return record;
    },
    touchLogin: async () => undefined,
    unlinkIdentity: async () => false,
  };

  const seedIdentity = (input: { provider: string; subject: string; userId: string }): void => {
    identities.set(key(input.provider, input.subject), {
      emailAtLink: null,
      emailVerifiedByProvider: true,
      id: `seed-${input.subject}`,
      lastLoginAt: null,
      linkedAt: NOW,
      provider: input.provider,
      providerSubject: input.subject,
      providerTenant: null,
      userId: input.userId,
    });
  };

  return { credentialed, flowStates, identities, port, seedIdentity };
};

const createFakeUsers = () => {
  const byId = new Map<string, AuthHonoUserRecord>();
  const byEmail = new Map<string, AuthHonoUserRecord>();
  let seq = 0;
  const seed = (user: { id: string; email: string; role?: string }): AuthHonoUserRecord => {
    const record: AuthHonoUserRecord = {
      accountStatus: 'pending_admin_approval',
      approvalDueAt: null,
      createdAt: NOW,
      displayName: null,
      email: user.email,
      emailVerified: true,
      id: user.id,
      role: user.role ?? 'editor',
      updatedAt: NOW,
    };
    byId.set(record.id, record);
    byEmail.set(record.email, record);
    return record;
  };
  const port = {
    create: vi.fn(async (input: { email: string; role: string; displayName?: string | null }) => {
      const record: AuthHonoUserRecord = {
        accountStatus: 'pending_admin_approval',
        approvalDueAt: null,
        createdAt: NOW,
        displayName: input.displayName ?? null,
        email: input.email,
        emailVerified: true,
        id: `created-user-${(seq += 1)}`,
        role: input.role,
        updatedAt: NOW,
      };
      byId.set(record.id, record);
      byEmail.set(record.email, record);
      return record;
    }),
    findByEmail: vi.fn(async (email: string) => byEmail.get(email) ?? null),
    findById: vi.fn(async (id: string) => byId.get(id) ?? null),
  };
  return { port, seed };
};

interface Harness {
  broker: ReturnType<typeof createFederationBroker>;
  federation: ReturnType<typeof createFakeFederation>;
  users: ReturnType<typeof createFakeUsers>;
  mintSession: ReturnType<typeof vi.fn>;
  verify: ReturnType<typeof vi.fn>;
  start(continuation?: string | null): Promise<{ flowStateId: string; location: string }>;
}

const harness = (
  options: { identity?: FederationProviderIdentity; verifyThrows?: boolean } = {},
): Harness => {
  const federation = createFakeFederation();
  const users = createFakeUsers();
  const { provider, verify } = createFakeGithubProvider(options);

  let sessionSeq = 0;
  const mintSession = vi.fn(async ({ user }: { user: AuthHonoUserRecord }) => {
    sessionSeq += 1;
    const tokens: AuthHonoSessionTokens = {
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      refreshToken: `refresh-${sessionSeq}`,
      sessionId: `session-${sessionSeq}`,
      sessionToken: `session-token-for-${user.id}`,
    };
    return tokens;
  });

  const deps: FederationBrokerDeps = {
    accountPolicy: {
      deriveDisplayName: (email) => email.split('@')[0] ?? email,
      normalizeEmail: (email) => email.trim().toLowerCase(),
      resolveSessionRole: (user) => user.role,
      roleForNewUser: async () => 'editor',
      statusForNewUser: async () => ({
        accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(NOW.getTime() + 48 * 60 * 60 * 1000),
      }),
    },
    audit: { record: vi.fn() },
    clock: { addSeconds: (date, seconds) => new Date(date.getTime() + seconds * 1000), now: () => NOW },
    config: {
      authorizeUrl: 'https://auth.example.com/auth/oauth/authorize',
      // GitHub is NOT here — only Google auto-links in v1 (D8).
      autoLinkProviders: new Set(['google']),
      flowStateTtlSeconds: 600,
      landingUrl: 'https://auth.example.com/',
    },
    federation: federation.port,
    mintSession,
    provider,
    provisionWorkspace: vi.fn(async () => undefined),
    secrets: { codeVerifier: () => 'verifier-123', nonce: () => 'nonce-xyz', state: () => 'state-abc' },
    users: users.port,
  };

  const broker = createFederationBroker(deps);
  const start = async (continuation: string | null = null) => {
    const result = await broker.start({ continuation });
    if (result.kind !== 'redirect') throw new Error(`expected redirect, got ${result.kind}`);
    return { flowStateId: result.flowStateId, location: result.location };
  };

  return { broker, federation, mintSession, start, users, verify };
};

const okCallback = { code: 'auth-code', error: null, state: 'state-abc' };

describe('BR-39e Lot 2 — GitHub federation keystones', () => {
  it('K-GH-SUBJECT: a returning GitHub subject resolves the existing identity → session, no challenge', async () => {
    const h = harness({ identity: { email: 'user@example.com', emailVerified: true, subject: 'gh-77' } });
    h.users.seed({ email: 'user@example.com', id: 'u-existing' });
    h.federation.seedIdentity({ provider: 'github', subject: 'gh-77', userId: 'u-existing' });

    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });

    expect(res.kind).toBe('authenticated');
    if (res.kind === 'authenticated') {
      expect(res.session.sessionToken).toBe('session-token-for-u-existing');
    }
    // Subject-first: no user was created and no challenge was raised.
    expect(h.users.port.create).not.toHaveBeenCalled();
  });

  it('K-GH-NOVERIFIED (no primary email): GitHub with no verified email → email-challenge, no user created', async () => {
    const h = harness({ identity: { email: null, emailVerified: false, subject: 'gh-88' } });
    const { flowStateId } = await h.start('SEALED.continuation');

    const res = await h.broker.callback({ flowStateId, ...okCallback });

    expect(res.kind).toBe('email-challenge');
    if (res.kind === 'email-challenge') {
      expect(res.provider).toBe('github');
      expect(res.providerSubject).toBe('gh-88');
      // The sealed continuation is preserved across the challenge (D11).
      expect(res.continuation).toBe('SEALED.continuation');
    }
    // D9: NO user/identity row is written and NO session is minted before the email is proven.
    expect(h.users.port.create).not.toHaveBeenCalled();
    expect(h.mintSession).not.toHaveBeenCalled();
    expect(await h.federation.port.findIdentityBySubject('github', 'gh-88')).toBeNull();
  });

  it('K-GH-NOVERIFIED (unverified primary email): a present-but-unverified email still challenges', async () => {
    const h = harness({ identity: { email: 'private@example.com', emailVerified: false, subject: 'gh-89' } });
    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res.kind).toBe('email-challenge');
    expect(h.mintSession).not.toHaveBeenCalled();
  });

  it('K-GH-MANUAL (credentialed): a GitHub verified-email collision with a credentialed account → manual-link, never merge', async () => {
    const h = harness({ identity: { email: 'real@example.com', emailVerified: true, subject: 'gh-attacker' } });
    h.users.seed({ email: 'real@example.com', id: 'real-user' });
    h.federation.credentialed.add('real-user');

    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });

    expect(res).toMatchObject({ kind: 'error', status: 409 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('account_exists_sign_in_to_link');
    expect(h.mintSession).not.toHaveBeenCalled();
    expect(await h.federation.port.findIdentityBySubject('github', 'gh-attacker')).toBeNull();
  });

  it('K-GH-MANUAL (shell): even a NON-credentialed shell collision → manual-link (GitHub NEVER auto-links, D8)', async () => {
    const h = harness({ identity: { email: 'shell@example.com', emailVerified: true, subject: 'gh-shell' } });
    h.users.seed({ email: 'shell@example.com', id: 'shell-user' }); // shell: not in `credentialed`

    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });

    // Contrast with Google (K-AUTOLINK): GitHub is not on the allowlist so this NEVER auto-links.
    expect(res).toMatchObject({ kind: 'error', status: 409 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('account_exists_sign_in_to_link');
    expect(h.mintSession).not.toHaveBeenCalled();
    expect(await h.federation.port.findIdentityBySubject('github', 'gh-shell')).toBeNull();
  });

  it('K-MANUAL-LINK-AUTH: the link callback rejects an unauthenticated caller and never verifies/consumes', async () => {
    const h = harness({ identity: { email: 'me@example.com', emailVerified: true, subject: 'gh-link' } });
    const { flowStateId } = await h.start();

    const res = await h.broker.linkCallback({ flowStateId, ...okCallback, linkUserId: null });

    expect(res).toMatchObject({ kind: 'error', status: 401 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('authentication_required');
    // Rejected BEFORE any provider verify or flow-state consume — no silent link.
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.federation.flowStates.has(flowStateId)).toBe(true);
  });

  it('K-MANUAL-LINK-AUTH: the link callback attaches the freshly-verified identity to the session user', async () => {
    const h = harness({ identity: { email: 'me@example.com', emailVerified: true, subject: 'gh-link' } });
    h.users.seed({ email: 'me@example.com', id: 'session-user' });
    const { flowStateId } = await h.start();

    const res = await h.broker.linkCallback({ flowStateId, ...okCallback, linkUserId: 'session-user' });

    expect(res.kind).toBe('linked');
    if (res.kind === 'linked') expect(res.userId).toBe('session-user');
    const linked = await h.federation.port.findIdentityBySubject('github', 'gh-link');
    expect(linked?.userId).toBe('session-user');
  });

  it('K-MANUAL-LINK-AUTH: linking an identity already bound to ANOTHER account is rejected', async () => {
    const h = harness({ identity: { email: 'me@example.com', emailVerified: true, subject: 'gh-owned' } });
    h.federation.seedIdentity({ provider: 'github', subject: 'gh-owned', userId: 'other-user' });
    const { flowStateId } = await h.start();

    const res = await h.broker.linkCallback({ flowStateId, ...okCallback, linkUserId: 'session-user' });

    expect(res).toMatchObject({ kind: 'error', status: 409 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('identity_linked_other_account');
  });

  it('K-MANUAL-LINK-AUTH: re-linking an identity already owned by the session user is idempotent', async () => {
    const h = harness({ identity: { email: 'me@example.com', emailVerified: true, subject: 'gh-mine' } });
    h.federation.seedIdentity({ provider: 'github', subject: 'gh-mine', userId: 'session-user' });
    const { flowStateId } = await h.start();

    const res = await h.broker.linkCallback({ flowStateId, ...okCallback, linkUserId: 'session-user' });

    expect(res.kind).toBe('linked');
    if (res.kind === 'linked') expect(res.userId).toBe('session-user');
  });

  it('completeEmailChallenge: a proven email with no collision creates the shell user + links the identity', async () => {
    const h = harness();
    const res = await h.broker.completeEmailChallenge({
      continuation: null,
      provider: 'github',
      providerSubject: 'gh-new',
      providerTenant: null,
      verifiedEmail: 'proven@example.com',
    });

    expect(res.kind).toBe('authenticated');
    expect(h.users.port.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'proven@example.com', emailVerified: true }),
    );
    const linked = await h.federation.port.findIdentityBySubject('github', 'gh-new');
    expect(linked).not.toBeNull();
    expect(h.mintSession).toHaveBeenCalled();
  });

  it('completeEmailChallenge: a proven email colliding with a credentialed account routes to manual-link', async () => {
    const h = harness();
    h.users.seed({ email: 'taken@example.com', id: 'taken-user' });
    h.federation.credentialed.add('taken-user');

    const res = await h.broker.completeEmailChallenge({
      continuation: null,
      provider: 'github',
      providerSubject: 'gh-collide',
      providerTenant: null,
      verifiedEmail: 'taken@example.com',
    });

    expect(res).toMatchObject({ kind: 'error', status: 409 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('account_exists_sign_in_to_link');
    expect(h.mintSession).not.toHaveBeenCalled();
  });
});
