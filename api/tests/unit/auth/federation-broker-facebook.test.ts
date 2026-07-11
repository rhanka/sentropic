import type {
  AuthHonoFederationFlowState,
  AuthHonoIdentityRecord,
  AuthHonoUserRecord,
} from '@sentropic/auth-hono';
import { describe, expect, it, vi } from 'vitest';

import { createFederationBroker } from '../../../src/services/auth/federation/broker';
import type { FederationBrokerDeps, FederationProviderIdentity } from '../../../src/services/auth/federation/types';

const NOW = new Date('2026-07-11T00:00:00.000Z');
const SECRET_TOKEN = 'EAAB_SECRET-facebook-token-must-never-leak';

const user = (id: string, email: string): AuthHonoUserRecord => ({
  accountStatus: 'pending_admin_approval',
  approvalDueAt: null,
  createdAt: NOW,
  displayName: null,
  email,
  emailVerified: true,
  id,
  role: 'editor',
  updatedAt: NOW,
});

const harness = (options: {
  identity: FederationProviderIdentity;
  existingIdentity?: AuthHonoIdentityRecord;
  existingUser?: AuthHonoUserRecord;
  credentialed?: boolean;
}) => {
  let flow: AuthHonoFederationFlowState | null = null;
  const createUser = vi.fn(async () => {
    throw new Error('unexpected user creation');
  });
  const linkIdentity = vi.fn(async () => {
    throw new Error('unexpected identity link');
  });
  const mintSession = vi.fn(async () => ({
    expiresAt: new Date(NOW.getTime() + 60_000),
    refreshToken: 'sentropic-refresh',
    sessionId: 'sentropic-session',
    sessionToken: 'sentropic-session-token',
  }));

  const deps = {
    accountPolicy: {
      deriveDisplayName: (email: string) => email,
      normalizeEmail: (email: string) => email.trim().toLowerCase(),
      resolveSessionRole: (record: AuthHonoUserRecord) => record.role,
      roleForNewUser: async () => 'editor',
      statusForNewUser: async () => ({ accountStatus: 'pending_admin_approval', approvalDueAt: null }),
    },
    audit: { record: vi.fn() },
    clock: { addSeconds: (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000), now: () => NOW },
    config: {
      authorizeUrl: 'https://auth.example.com/auth/oauth/authorize',
      autoLinkProviders: new Set(['google']),
      flowStateTtlSeconds: 600,
      landingUrl: 'https://auth.example.com/',
    },
    federation: {
      consumeFlowState: async () => {
        const consumed = flow;
        flow = null;
        return consumed;
      },
      createFlowState: async (input: Omit<AuthHonoFederationFlowState, 'createdAt' | 'id'> & { now: Date }) => {
        flow = { ...input, createdAt: input.now, id: 'facebook-flow' };
        return flow;
      },
      findIdentitiesForUser: async () => options.existingIdentity ? [options.existingIdentity] : [],
      findIdentityBySubject: async () => options.existingIdentity ?? null,
      isUserCredentialed: async () => options.credentialed ?? false,
      linkIdentity,
      touchLogin: vi.fn(async () => undefined),
      unlinkIdentity: async () => false,
    },
    mintSession,
    provider: {
      createAuthorizationUrl: ({ state }: { state: string }) => `https://facebook.example/authorize?state=${state}`,
      id: 'facebook',
      verifyCallback: async () => {
        void SECRET_TOKEN;
        return options.identity;
      },
    },
    provisionWorkspace: vi.fn(async () => undefined),
    secrets: { codeVerifier: () => 'unused', nonce: () => 'unused', state: () => 'facebook-state' },
    users: {
      create: createUser,
      findByEmail: async () => options.existingUser ?? null,
      findById: async () => options.existingUser ?? null,
    },
  } as unknown as FederationBrokerDeps;

  return { broker: createFederationBroker(deps), createUser, linkIdentity, mintSession };
};

const callback = async (h: ReturnType<typeof harness>) => {
  const started = await h.broker.start({ continuation: 'SEALED.continuation' });
  if (started.kind !== 'redirect') throw new Error('expected redirect');
  return h.broker.callback({
    code: 'facebook-code',
    error: null,
    flowStateId: started.flowStateId,
    state: 'facebook-state',
  });
};

describe('Facebook federation broker keystones (BR-39e Lot 5)', () => {
  it('K-FB-CHALLENGE: absent email issues the existing challenge without creating rows or a session', async () => {
    const h = harness({ identity: { email: null, emailVerified: false, subject: 'fb-no-email' } });

    const result = await callback(h);

    expect(result).toMatchObject({ kind: 'email-challenge', provider: 'facebook', providerSubject: 'fb-no-email' });
    expect(h.createUser).not.toHaveBeenCalled();
    expect(h.linkIdentity).not.toHaveBeenCalled();
    expect(h.mintSession).not.toHaveBeenCalled();
  });

});
