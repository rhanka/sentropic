import { describe, expect, it, vi } from 'vitest';

import {
  AuthHonoIdentityConflictError,
  resolveOrCreateFederatedUser,
  type AuthHonoCreateUserInput,
  type AuthHonoFederationPort,
  type AuthHonoIdentityRecord,
  type AuthHonoLinkIdentityInput,
  type AuthHonoUserRecord,
  type FederationResolveDeps,
} from '../src/index.js';

/**
 * BR-39e Lot 0 — the SAFE federated user-resolution algorithm (D6/D7), tested as a pure function
 * with in-memory fakes so the account-takeover guarantees hold independent of any DB/provider code.
 *
 * Keystones: K-SUBJECT (subject-first, ignores fuzzy email), K-AUTOLINK-SHELL (verified-email
 * collision into a non-credentialed shell links), K-NOMERGE-CRED (credentialed collision → manual
 * link, NO merge), K-NOMERGE-UNVERIFIED (unverified email never links), K-UNIQUE (concurrent
 * UNIQUE-race → conflict re-read logs the winner in), plus the D8 non-allowlisted-provider guard.
 */

const now = new Date('2026-07-10T00:00:00.000Z');
const key = (provider: string, subject: string): string => `${provider}::${subject}`;

const makeIdentity = (
  id: string,
  userId: string,
  input: AuthHonoLinkIdentityInput,
): AuthHonoIdentityRecord => ({
  emailAtLink: input.emailAtLink,
  emailVerifiedByProvider: input.emailVerifiedByProvider,
  id,
  lastLoginAt: input.now,
  linkedAt: input.now,
  provider: input.provider,
  providerSubject: input.providerSubject,
  providerTenant: input.providerTenant ?? null,
  userId,
});

interface FakeState {
  credentialed: Set<string>;
  identities: Map<string, AuthHonoIdentityRecord>;
  usersByEmail: Map<string, AuthHonoUserRecord>;
}

const newState = (): FakeState => ({
  credentialed: new Set(),
  identities: new Map(),
  usersByEmail: new Map(),
});

const seedUser = (
  state: FakeState,
  user: { id: string; email: string; credentialed?: boolean },
): AuthHonoUserRecord => {
  const record: AuthHonoUserRecord = {
    accountStatus: 'pending_admin_approval',
    approvalDueAt: null,
    createdAt: now,
    displayName: null,
    email: user.email,
    emailVerified: true,
    id: user.id,
    role: 'editor',
    updatedAt: now,
  };
  state.usersByEmail.set(user.email, record);
  if (user.credentialed) state.credentialed.add(user.id);
  return record;
};

const seedIdentity = (
  state: FakeState,
  input: { provider: string; subject: string; userId: string; email: string | null },
): void => {
  const record = makeIdentity('seed-identity', input.userId, {
    emailAtLink: input.email,
    emailVerifiedByProvider: true,
    now,
    provider: input.provider,
    providerSubject: input.subject,
    userId: input.userId,
  });
  state.identities.set(key(input.provider, input.subject), record);
};

const createFakeFederation = (
  state: FakeState,
  options: { conflict?: { winnerUserId: string } } = {},
): AuthHonoFederationPort => {
  let idSeq = 0;
  let conflictPending = options.conflict;
  return {
    consumeFlowState: vi.fn(async () => null),
    createFlowState: vi.fn(async () => {
      throw new Error('flow-state is exercised in the api adapter test, not the resolver test');
    }),
    findIdentitiesForUser: vi.fn(async (userId) =>
      [...state.identities.values()].filter((identity) => identity.userId === userId),
    ),
    findIdentityBySubject: vi.fn(async (provider, subject) => state.identities.get(key(provider, subject)) ?? null),
    isUserCredentialed: vi.fn(async (userId) => state.credentialed.has(userId)),
    linkIdentity: vi.fn(async (input) => {
      const composite = key(input.provider, input.providerSubject);
      if (conflictPending) {
        // Model a concurrent callback that won the UNIQUE(provider,subject) race between our find
        // and our insert: materialize its row so the re-read sees it, then reject our insert.
        state.identities.set(composite, makeIdentity(`winner-${++idSeq}`, conflictPending.winnerUserId, input));
        conflictPending = undefined;
        throw new AuthHonoIdentityConflictError(input.provider, input.providerSubject);
      }
      if (state.identities.has(composite)) {
        throw new AuthHonoIdentityConflictError(input.provider, input.providerSubject);
      }
      const record = makeIdentity(`identity-${++idSeq}`, input.userId, input);
      state.identities.set(composite, record);
      return record;
    }),
    touchLogin: vi.fn(async () => undefined),
    unlinkIdentity: vi.fn(async () => false),
  };
};

const buildDeps = (
  state: FakeState,
  federation: AuthHonoFederationPort,
  overrides: Partial<FederationResolveDeps> = {},
): FederationResolveDeps => {
  let created = 0;
  const users = {
    create: vi.fn(async (input: AuthHonoCreateUserInput): Promise<AuthHonoUserRecord> => {
      const record: AuthHonoUserRecord = {
        accountStatus: input.accountStatus ?? 'active',
        approvalDueAt: input.approvalDueAt ?? null,
        createdAt: now,
        displayName: input.displayName ?? null,
        email: input.email,
        emailVerified: input.emailVerified ?? false,
        id: `created-user-${(created += 1)}`,
        role: input.role,
        updatedAt: now,
      };
      state.usersByEmail.set(input.email, record);
      return record;
    }),
    findByEmail: vi.fn(async (email: string) => state.usersByEmail.get(email) ?? null),
  };
  return {
    accountPolicy: {
      deriveDisplayName: (email: string) => email.split('@')[0] ?? email,
      normalizeEmail: (email: string) => email.trim().toLowerCase(),
      roleForNewUser: async () => 'editor',
      statusForNewUser: async () => ({
        accountStatus: 'pending_admin_approval',
        approvalDueAt: new Date(now.getTime() + 48 * 60 * 60 * 1000),
      }),
    },
    autoLinkProviders: new Set(['google']),
    federation,
    provisionWorkspace: vi.fn(async () => undefined),
    users,
    ...overrides,
  };
};

describe('resolveOrCreateFederatedUser (BR-39e Lot 0 SAFE linking)', () => {
  it('K-SUBJECT: resolves by (provider, subject) FIRST and ignores a now-different provider email', async () => {
    const state = newState();
    seedIdentity(state, { email: 'old@example.com', provider: 'google', subject: 'sub-123', userId: 'user-A' });
    // A DIFFERENT user owns the email the provider now asserts — the fuzzy email path must NOT run.
    seedUser(state, { credentialed: true, email: 'new@example.com', id: 'user-B' });
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'new@example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'google',
      providerSubject: 'sub-123',
    });

    expect(outcome).toEqual({ identity: expect.objectContaining({ userId: 'user-A' }), kind: 'linked-existing', userId: 'user-A' });
    expect(federation.touchLogin).toHaveBeenCalledWith('seed-identity', now);
    // Email was never consulted: no collision lookup, no new user, no new identity.
    expect(deps.users.findByEmail).not.toHaveBeenCalled();
    expect(deps.users.create).not.toHaveBeenCalled();
    expect(federation.linkIdentity).not.toHaveBeenCalled();
  });

  it('K-AUTOLINK-SHELL: verified-email collision with a non-credentialed shell + allowlisted provider → auto-links', async () => {
    const state = newState();
    const shell = seedUser(state, { credentialed: false, email: 'shell@example.com', id: 'shell-user' });
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'shell@example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'google',
      providerSubject: 'sub-shell',
    });

    expect(outcome.kind).toBe('auto-linked');
    expect(outcome).toMatchObject({ userId: shell.id });
    expect(federation.linkIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google', providerSubject: 'sub-shell', userId: 'shell-user' }));
    expect(deps.provisionWorkspace).toHaveBeenCalledWith('shell-user');
    expect(deps.users.create).not.toHaveBeenCalled();
  });

  it('K-NOMERGE-CRED: verified-email collision with an ALREADY-CREDENTIALED account → manual-link, NO merge, NO identity written', async () => {
    const state = newState();
    seedUser(state, { credentialed: true, email: 'real@example.com', id: 'real-user' });
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'real@example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'google',
      providerSubject: 'sub-attacker',
    });

    expect(outcome).toEqual({ existingUserId: 'real-user', kind: 'manual-link-required', reason: 'credentialed_account' });
    expect(federation.linkIdentity).not.toHaveBeenCalled();
    expect(deps.provisionWorkspace).not.toHaveBeenCalled();
    expect(state.identities.size).toBe(0);
  });

  it('D8 guard: a verified-email collision from a NON-allowlisted provider → manual-link (never auto-link)', async () => {
    const state = newState();
    seedUser(state, { credentialed: false, email: 'shell@example.com', id: 'shell-user' });
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation); // allowlist = google only

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'shell@example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'github',
      providerSubject: 'gh-999',
    });

    expect(outcome).toEqual({ existingUserId: 'shell-user', kind: 'manual-link-required', reason: 'provider_not_auto_link' });
    expect(federation.linkIdentity).not.toHaveBeenCalled();
  });

  it('K-NOMERGE-UNVERIFIED: an unverified provider email never links or creates — routes to email challenge (D9)', async () => {
    const state = newState();
    seedUser(state, { credentialed: false, email: 'shell@example.com', id: 'shell-user' });
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'shell@example.com',
      emailVerifiedByProvider: false, // provider did NOT assert verified
      now,
      provider: 'google',
      providerSubject: 'sub-unverified',
    });

    expect(outcome).toEqual({ kind: 'email-challenge-required', provider: 'google', providerSubject: 'sub-unverified' });
    expect(deps.users.findByEmail).not.toHaveBeenCalled();
    expect(federation.linkIdentity).not.toHaveBeenCalled();
    expect(deps.provisionWorkspace).not.toHaveBeenCalled();
  });

  it('no subject match, no collision, verified email → creates user + identity + provisions workspace', async () => {
    const state = newState();
    const federation = createFakeFederation(state);
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'Fresh@Example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'google',
      providerSubject: 'sub-fresh',
    });

    expect(outcome.kind).toBe('created');
    expect(deps.users.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'fresh@example.com', emailVerified: true, role: 'editor' }),
    );
    expect(federation.linkIdentity).toHaveBeenCalledWith(expect.objectContaining({ providerSubject: 'sub-fresh' }));
    if (outcome.kind === 'created') expect(deps.provisionWorkspace).toHaveBeenCalledWith(outcome.userId);
  });

  it('K-UNIQUE: a concurrent UNIQUE(provider,subject) race → conflict is caught, the identity re-read logs the winner in', async () => {
    const state = newState();
    // A concurrent callback for the same subject already created identity → user "winner".
    const federation = createFakeFederation(state, { conflict: { winnerUserId: 'winner-user' } });
    const deps = buildDeps(state, federation);

    const outcome = await resolveOrCreateFederatedUser(deps, {
      email: 'race@example.com',
      emailVerifiedByProvider: true,
      now,
      provider: 'google',
      providerSubject: 'sub-race',
    });

    // We created our own user, but the UNIQUE conflict re-read resolves the winner — idempotent.
    expect(deps.users.create).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ identity: expect.objectContaining({ userId: 'winner-user' }), kind: 'linked-existing', userId: 'winner-user' });
    expect(federation.findIdentityBySubject).toHaveBeenCalledTimes(2); // initial miss + conflict re-read
  });
});
