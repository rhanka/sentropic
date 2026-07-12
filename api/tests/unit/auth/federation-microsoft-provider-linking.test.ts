import {
  resolveOrCreateFederatedUser,
  type AuthHonoFederationPort,
} from '@sentropic/auth-hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findByEmail = vi.fn();
const findIdentityBySubject = vi.fn();
const linkIdentity = vi.fn();

const federation = {
  findIdentityBySubject,
  isUserCredentialed: vi.fn(),
  linkIdentity,
  touchLogin: vi.fn(),
} as unknown as AuthHonoFederationPort;

const deps = {
  accountPolicy: {
    deriveDisplayName: (email: string) => email,
    normalizeEmail: (email: string) => email.trim().toLowerCase(),
    roleForNewUser: vi.fn(),
    statusForNewUser: vi.fn(),
  },
  autoLinkProviders: new Set(['google']),
  federation,
  provisionWorkspace: vi.fn(),
  users: { create: vi.fn(), findByEmail },
};

const microsoftIdentity = {
  email: 'shell@example.com',
  now: new Date('2026-07-11T00:00:00.000Z'),
  provider: 'microsoft',
  providerSubject: 'entra-oid',
  providerTenant: '11111111-1111-1111-1111-111111111111',
};

describe('Microsoft manual-link policy (BR-39e Lot 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findIdentityBySubject.mockResolvedValue(null);
  });

  it('never auto-links an unverified Microsoft email and requires a local email challenge', async () => {
    const outcome = await resolveOrCreateFederatedUser(deps, {
      ...microsoftIdentity,
      emailVerifiedByProvider: false,
    });

    expect(outcome).toEqual({
      kind: 'email-challenge-required',
      provider: 'microsoft',
      providerSubject: 'entra-oid',
    });
    expect(findByEmail).not.toHaveBeenCalled();
    expect(linkIdentity).not.toHaveBeenCalled();
  });

  it('routes even a verified Microsoft shell collision to manual-link because only Google is allowlisted', async () => {
    findByEmail.mockResolvedValue({ id: 'shell-user' });

    const outcome = await resolveOrCreateFederatedUser(deps, {
      ...microsoftIdentity,
      emailVerifiedByProvider: true,
    });

    expect(outcome).toEqual({
      existingUserId: 'shell-user',
      kind: 'manual-link-required',
      reason: 'provider_not_auto_link',
    });
    expect(linkIdentity).not.toHaveBeenCalled();
  });
});
