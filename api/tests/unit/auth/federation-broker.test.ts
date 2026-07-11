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
 * BR-39e Lot 1 — the federation BROKER core, tested as a pure unit with in-memory fakes (no DB,
 * no arctic, no network). Keystones:
 *  - K-SEALED   the sealed OAuth continuation is NEVER placed in the upstream auth URL; it is held
 *               server-side in the flow-state, referenced by the opaque pointer only (D5).
 *  - K-FLOW     the one-time flow-state is single-use — a replayed callback is rejected (D5).
 *  - K-STATE    a mismatched / absent upstream `state` is rejected (D5/D10).
 *  - K-NONCE    a provider verification failure (id_token nonce/sig/iss/aud) is rejected (D10).
 *  - K-NOLEAK   the external provider tokens never reach the broker output / minted session (D1).
 *  - K-AUTOLINK a Google verified email auto-links into a NON-credentialed shell (D7/D8).
 *  - K-NOMERGE  a Google verified email colliding with a CREDENTIALED account never merges (D7/OD2).
 *  - K-ROTATE   the Sentropic session id is fresh on every federation login (anti-fixation, D10).
 */

const NOW = new Date('2026-07-11T00:00:00.000Z');
// The fake provider's secret upstream token. The real Google provider drops it inside verifyCallback;
// this value must NEVER appear anywhere in the broker output (K-NOLEAK).
const SECRET_UPSTREAM_TOKEN = 'ya29.SECRET-google-token-must-never-leak-downstream';

const key = (provider: string, subject: string): string => `${provider}::${subject}`;

const createFakeProvider = (
  options: { identity?: FederationProviderIdentity; verifyThrows?: boolean } = {},
): { provider: FederationProvider; lastAuthUrl: () => string } => {
  let lastAuthUrl = '';
  const provider: FederationProvider = {
    id: 'google',
    createAuthorizationUrl({ codeVerifier, nonce, state }) {
      // A realistic upstream URL carrying ONLY state + nonce + PKCE challenge.
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', 'test-client');
      url.searchParams.set('code_challenge', `s256-of-${codeVerifier}`);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      lastAuthUrl = url.toString();
      return lastAuthUrl;
    },
    async verifyCallback() {
      // The real provider verifies + then DROPS the external tokens; the fake holds a secret to
      // prove the broker has no path to it.
      void SECRET_UPSTREAM_TOKEN;
      if (options.verifyThrows) throw new Error('id_token nonce mismatch');
      return options.identity ?? { email: 'user@example.com', emailVerified: true, subject: 'sub-1' };
    },
  };
  return { lastAuthUrl: () => lastAuthUrl, provider };
};

const createFakeFederation = () => {
  const identities = new Map<string, AuthHonoIdentityRecord>();
  const flowStates = new Map<string, AuthHonoFederationFlowState>();
  const credentialed = new Set<string>();
  let seq = 0;

  const port: AuthHonoFederationPort = {
    consumeFlowState: async (id, now) => {
      const record = flowStates.get(id);
      if (!record || record.expiresAt <= now) return null; // TTL: expired never consumes
      flowStates.delete(id); // verify-and-DELETE: single-use
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
  mintedSessions: AuthHonoSessionTokens[];
  provisionWorkspace: ReturnType<typeof vi.fn>;
  lastAuthUrl: () => string;
  start(continuation?: string | null): Promise<{ flowStateId: string; location: string }>;
}

const harness = (
  options: {
    identity?: FederationProviderIdentity;
    verifyThrows?: boolean;
    config?: Partial<FederationBrokerDeps['config']>;
  } = {},
): Harness => {
  const federation = createFakeFederation();
  const users = createFakeUsers();
  const { lastAuthUrl, provider } = createFakeProvider({
    identity: options.identity,
    verifyThrows: options.verifyThrows,
  });

  const mintedSessions: AuthHonoSessionTokens[] = [];
  let sessionSeq = 0;
  const mintSession = vi.fn(async ({ user }: { user: AuthHonoUserRecord }) => {
    sessionSeq += 1;
    // A session token derived from the USER (never from any provider token) — proves K-NOLEAK.
    const tokens: AuthHonoSessionTokens = {
      expiresAt: new Date(NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
      refreshToken: `refresh-${sessionSeq}`,
      sessionId: `session-${sessionSeq}`,
      sessionToken: `session-token-for-${user.id}-role-${user.role}`,
    };
    mintedSessions.push(tokens);
    return tokens;
  });
  const provisionWorkspace = vi.fn(async () => undefined);

  const broker = createFederationBroker({
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
      autoLinkProviders: new Set(['google']),
      flowStateTtlSeconds: 600,
      landingUrl: 'https://auth.example.com/',
      ...options.config,
    },
    federation: federation.port,
    mintSession,
    provider,
    provisionWorkspace,
    secrets: { codeVerifier: () => 'verifier-123', nonce: () => 'nonce-xyz', state: () => 'state-abc' },
    users: users.port,
  });

  const start = async (continuation: string | null = null) => {
    const result = await broker.start({ continuation });
    if (result.kind !== 'redirect') throw new Error(`expected redirect, got ${result.kind}`);
    return { flowStateId: result.flowStateId, location: result.location };
  };

  return {
    broker,
    federation,
    lastAuthUrl,
    mintedSessions,
    mintSession,
    provisionWorkspace,
    start,
    users,
  };
};

const okCallback = {
  code: 'auth-code',
  error: null,
  state: 'state-abc',
};

describe('createFederationBroker (BR-39e Lot 1 broker core)', () => {
  it('K-SEALED: the sealed continuation is held server-side, never in the upstream auth URL', async () => {
    const h = harness();
    const continuation = 'SEALEDBODY.hmacsig.carries-clientId-redirectUri-scopes';
    const { flowStateId, location } = await h.start(continuation);

    // The upstream authorization URL (and the redirect the browser follows) carry state+nonce+PKCE
    // but NEVER the sealed continuation.
    expect(location).toContain('state=state-abc');
    expect(location).toContain('nonce=nonce-xyz');
    expect(location).not.toContain('SEALEDBODY');
    expect(h.lastAuthUrl()).not.toContain('SEALEDBODY');

    // The continuation is held SERVER-SIDE; the browser round-trips only the opaque pointer.
    const flow = h.federation.flowStates.get(flowStateId);
    expect(flow?.continuationToken).toBe(continuation);
    expect(flowStateId).not.toBe(continuation);
    expect(flow?.upstreamState).toBe('state-abc');
    expect(flow?.nonce).toBe('nonce-xyz');
    expect(flow?.codeVerifier).toBe('verifier-123');
  });

  it('K-FLOW: the one-time flow-state is single-use — a replayed callback is rejected', async () => {
    const h = harness();
    const { flowStateId } = await h.start();

    const first = await h.broker.callback({ flowStateId, ...okCallback });
    expect(first.kind).toBe('authenticated');

    const replay = await h.broker.callback({ flowStateId, ...okCallback });
    expect(replay).toMatchObject({ kind: 'error', status: 400 });
    if (replay.kind === 'error') expect(replay.body.error.code).toBe('federation_flow_invalid');
  });

  it('K-FLOW (TTL): an expired flow-state is rejected', async () => {
    const h = harness({ config: { flowStateTtlSeconds: -1 } }); // expiresAt < now at creation
    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res).toMatchObject({ kind: 'error', status: 400 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('federation_flow_invalid');
  });

  it('K-STATE: a mismatched or absent upstream state is rejected', async () => {
    const h = harness();
    const { flowStateId } = await h.start();
    const mismatch = await h.broker.callback({ code: 'c', error: null, flowStateId, state: 'WRONG' });
    expect(mismatch).toMatchObject({ kind: 'error', status: 400 });
    if (mismatch.kind === 'error') expect(mismatch.body.error.code).toBe('federation_state_mismatch');

    const { flowStateId: f2 } = await h.start();
    const absent = await h.broker.callback({ code: 'c', error: null, flowStateId: f2, state: null });
    if (absent.kind === 'error') expect(absent.body.error.code).toBe('federation_state_mismatch');
  });

  it('K-NONCE: a provider verification failure (id_token nonce/sig/iss/aud) is rejected', async () => {
    const h = harness({ verifyThrows: true });
    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res).toMatchObject({ kind: 'error', status: 401 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('federation_verification_failed');
    expect(h.mintSession).not.toHaveBeenCalled();
  });

  it('K-NOLEAK: external provider tokens never reach the broker output or the minted session', async () => {
    const h = harness({ identity: { email: 'leak@example.com', emailVerified: true, subject: 'sub-leak' } });
    const { flowStateId } = await h.start();
    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res.kind).toBe('authenticated');
    if (res.kind !== 'authenticated') return;

    const everythingReturned = JSON.stringify(res);
    const everythingMinted = h.mintedSessions
      .map((session) => `${session.sessionToken}|${session.refreshToken}`)
      .join('|');
    expect(everythingReturned).not.toContain(SECRET_UPSTREAM_TOKEN);
    expect(everythingMinted).not.toContain(SECRET_UPSTREAM_TOKEN);
    // The Sentropic session is minted from the USER, not from any provider material.
    expect(res.session.sessionToken).toContain('session-token-for-');
    expect(res.session.sessionToken).not.toContain(SECRET_UPSTREAM_TOKEN);
  });

  it('K-AUTOLINK: a Google verified email auto-links into a NON-credentialed shell user', async () => {
    const h = harness({ identity: { email: 'shell@example.com', emailVerified: true, subject: 'sub-shell' } });
    h.users.seed({ email: 'shell@example.com', id: 'shell-user' }); // shell: never added to `credentialed`
    const { flowStateId } = await h.start();

    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res.kind).toBe('authenticated');

    const linked = await h.federation.port.findIdentityBySubject('google', 'sub-shell');
    expect(linked?.userId).toBe('shell-user');
    expect(h.mintSession).toHaveBeenCalledWith(
      expect.objectContaining({ user: expect.objectContaining({ id: 'shell-user' }) }),
    );
    expect(h.provisionWorkspace).toHaveBeenCalledWith('shell-user');
    expect(h.users.port.create).not.toHaveBeenCalled();
  });

  it('K-NOMERGE-CRED: a Google verified email colliding with a CREDENTIALED account never merges', async () => {
    const h = harness({ identity: { email: 'real@example.com', emailVerified: true, subject: 'sub-attacker' } });
    h.users.seed({ email: 'real@example.com', id: 'real-user' });
    h.federation.credentialed.add('real-user'); // already holds a sign-in factor
    const { flowStateId } = await h.start();

    const res = await h.broker.callback({ flowStateId, ...okCallback });
    expect(res).toMatchObject({ kind: 'error', status: 409 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('account_exists_sign_in_to_link');
    expect(h.mintSession).not.toHaveBeenCalled();
    // No identity row is attached to the credentialed account.
    expect(await h.federation.port.findIdentityBySubject('google', 'sub-attacker')).toBeNull();
  });

  it('K-ROTATE: every federation login mints a FRESH session id (anti session-fixation)', async () => {
    const h = harness({ identity: { email: 'rot@example.com', emailVerified: true, subject: 'sub-rotate' } });
    h.users.seed({ email: 'rot@example.com', id: 'rot-user' });
    h.federation.seedIdentity({ provider: 'google', subject: 'sub-rotate', userId: 'rot-user' });

    const f1 = await h.start();
    const r1 = await h.broker.callback({ flowStateId: f1.flowStateId, ...okCallback });
    const f2 = await h.start();
    const r2 = await h.broker.callback({ flowStateId: f2.flowStateId, ...okCallback });

    expect(r1.kind).toBe('authenticated');
    expect(r2.kind).toBe('authenticated');
    if (r1.kind === 'authenticated' && r2.kind === 'authenticated') {
      expect(r1.session.sessionId).not.toBe(r2.session.sessionId);
    }
  });

  it('D11: resumes the sealed continuation when present, else lands on the fixed internal page', async () => {
    const continuation = 'SEALED.hmac.continuation';
    const withCont = harness({ identity: { email: 'a@example.com', emailVerified: true, subject: 'sub-a' } });
    const c1 = await withCont.start(continuation);
    const r1 = await withCont.broker.callback({ flowStateId: c1.flowStateId, ...okCallback });
    expect(r1.kind).toBe('authenticated');
    if (r1.kind === 'authenticated') {
      expect(r1.location).toContain('https://auth.example.com/auth/oauth/authorize');
      expect(r1.location).toContain('continue=');
    }

    const noCont = harness({ identity: { email: 'b@example.com', emailVerified: true, subject: 'sub-b' } });
    const c2 = await noCont.start(null);
    const r2 = await noCont.broker.callback({ flowStateId: c2.flowStateId, ...okCallback });
    if (r2.kind === 'authenticated') expect(r2.location).toBe('https://auth.example.com/');
  });

  it('K-MIXUP: a flow-state minted for a different provider is rejected on this callback', async () => {
    // The broker's provider is 'google'; mint a flow-state pinned to ANOTHER provider ('microsoft')
    // with an otherwise-valid state, then replay it onto google's callback. The IdP mix-up guard must
    // reject it BEFORE any state/code/verify step (defence against a cross-provider flow-state swap).
    const h = harness();
    const foreignFlow = await h.federation.port.createFlowState({
      codeVerifier: 'verifier-123',
      continuationToken: null,
      expiresAt: new Date(NOW.getTime() + 600 * 1000),
      nonce: 'nonce-xyz',
      now: NOW,
      provider: 'microsoft',
      upstreamState: 'state-abc',
    });

    const res = await h.broker.callback({ flowStateId: foreignFlow.id, ...okCallback });
    expect(res).toMatchObject({ kind: 'error', status: 400 });
    if (res.kind === 'error') expect(res.body.error.code).toBe('federation_provider_mismatch');
    // The mismatch short-circuits before verification / session mint.
    expect(h.mintSession).not.toHaveBeenCalled();
  });
});
