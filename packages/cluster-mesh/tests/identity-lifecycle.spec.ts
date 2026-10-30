import { describe, expect, it } from 'vitest';
import {
  AccountTransitionError,
  AdminUserProtectedError,
  IdentityConflictError,
  IdentityNotFoundError,
  InvitationError,
  LoginSessionError,
  ProofVerificationError,
  SelfActionForbiddenError,
  createIdentityProofs,
  createInMemoryIdentityStores,
  createInvitations,
  createLoginSessions,
  createStubTokenPort,
  createUserAccounts,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T13:00:00.000Z';
const CLOCK = () => NOW;

function setup() {
  const stores = createInMemoryIdentityStores();
  return {
    stores,
    accounts: createUserAccounts({ accounts: stores.accounts, audit: stores.audit, clock: CLOCK }),
    proofs: createIdentityProofs({ proofs: stores.proofs, clock: CLOCK }),
    invitations: createInvitations({
      invitations: stores.invitations,
      tokens: createStubTokenPort(),
      audit: stores.audit,
      clock: CLOCK,
    }),
    sessions: createLoginSessions({ sessions: stores.sessions, clock: CLOCK }),
  };
}

describe('user accounts and lifecycle', () => {
  it('should register accounts as pending_admin_approval by default', async () => {
    const { accounts } = setup();
    const account = await accounts.register({ userId: 'user-1', email: 'a@example.com' });
    expect(account).toMatchObject({
      userId: 'user-1',
      email: 'a@example.com',
      accountStatus: 'pending_admin_approval',
    });
  });

  it('should activate the first admin directly with the bootstrap option', async () => {
    const { accounts } = setup();
    const account = await accounts.register(
      { userId: 'user-1', email: 'a@example.com' },
      { firstAdmin: true },
    );
    expect(account).toMatchObject({ accountStatus: 'active', globalRole: 'admin_app' });
  });

  it('should refuse a duplicate email', async () => {
    const { accounts } = setup();
    await accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await expect(
      accounts.register({ userId: 'user-2', email: 'a@example.com' }),
    ).rejects.toBeInstanceOf(IdentityConflictError);
  });

  it('should approve an account with a role as a distinct first approval', async () => {
    const { accounts } = setup();
    await accounts.register({ userId: 'user-1', email: 'a@example.com' });
    const approved = await accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    expect(approved).toMatchObject({ accountStatus: 'active', globalRole: 'editor' });
  });

  it('should disable and reactivate an account, and refuse invalid transitions', async () => {
    const { accounts } = setup();
    await accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    await accounts.disableAccount('user-1', 'admin');
    expect((await accounts.getAccount('user-1')).accountStatus).toBe('disabled');
    await accounts.reactivateAccount('user-1', 'admin');
    expect((await accounts.getAccount('user-1')).accountStatus).toBe('active');
    await expect(accounts.reactivateAccount('user-1', 'admin')).rejects.toBeInstanceOf(
      AccountTransitionError,
    );
    await expect(accounts.deleteAccount('user-1', 'admin')).rejects.toBeInstanceOf(
      AccountTransitionError,
    );
    await accounts.disableAccount('user-1', 'admin');
    await accounts.deleteAccount('user-1', 'admin');
    await expect(accounts.getAccount('user-1')).rejects.toBeInstanceOf(IdentityNotFoundError);
  });

  it('should refuse admin self-actions and protect admin users', async () => {
    const { accounts } = setup();
    await accounts.register({ userId: 'user-1', email: 'a@example.com' }, { firstAdmin: true });
    await accounts.register({ userId: 'user-2', email: 'b@example.com' }, { firstAdmin: true });
    await expect(accounts.disableAccount('user-1', 'user-1')).rejects.toBeInstanceOf(
      SelfActionForbiddenError,
    );
    await expect(accounts.disableAccount('user-2', 'user-1')).rejects.toBeInstanceOf(
      AdminUserProtectedError,
    );
    await expect(accounts.deleteAccount('user-2', 'user-1')).rejects.toBeInstanceOf(
      AdminUserProtectedError,
    );
    await accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    await accounts.disableAccount('user-1', 'admin');
    expect(await accounts.listUsers()).toHaveLength(2);
  });

  it('should expose the self-service get, disable and delete path for the own account', async () => {
    const { accounts } = setup();
    await accounts.register({ userId: 'user-1', email: 'a@example.com' }, { firstAdmin: true });
    expect((await accounts.getSelf('user-1')).accountStatus).toBe('active');
    await expect(accounts.deleteSelf('user-1')).rejects.toBeInstanceOf(AccountTransitionError);
    const disabled = await accounts.disableSelf('user-1');
    expect(disabled.accountStatus).toBe('disabled');
    await expect(accounts.disableSelf('user-1')).rejects.toBeInstanceOf(AccountTransitionError);
    await accounts.deleteSelf('user-1');
    await expect(accounts.getSelf('user-1')).rejects.toBeInstanceOf(IdentityNotFoundError);
  });
});

describe('identity proofs', () => {
  it('should verify a reusable webauthn proof without consuming it', async () => {
    const { proofs } = setup();
    await proofs.registerProof({ proofId: 'p1', userId: 'user-1', kind: 'webauthn' });
    const first = await proofs.verifyProof({ proofId: 'p1', userId: 'user-1' }, NOW);
    const second = await proofs.verifyProof({ proofId: 'p1', userId: 'user-1' }, LATER);
    expect(first).toMatchObject({ userId: 'user-1', kind: 'webauthn' });
    expect(second).toMatchObject({ userId: 'user-1', kind: 'webauthn' });
  });

  it('should consume a single-use email code exactly once', async () => {
    const { proofs } = setup();
    await proofs.registerProof({ proofId: 'p1', userId: 'user-1', kind: 'email_code' });
    await proofs.verifyProof({ proofId: 'p1', userId: 'user-1' }, NOW);
    await expect(proofs.verifyProof({ proofId: 'p1', userId: 'user-1' }, LATER)).rejects.toBeInstanceOf(
      ProofVerificationError,
    );
  });

  it('should refuse expired and revoked proofs and mismatched users', async () => {
    const { proofs } = setup();
    await proofs.registerProof({ proofId: 'p1', userId: 'user-1', kind: 'magic_link', expiresAt: NOW });
    await expect(proofs.verifyProof({ proofId: 'p1', userId: 'user-1' }, LATER)).rejects.toBeInstanceOf(
      ProofVerificationError,
    );
    await proofs.registerProof({ proofId: 'p2', userId: 'user-1', kind: 'social', provider: 'github' });
    await proofs.revokeProof('p2', 'admin');
    await expect(proofs.verifyProof({ proofId: 'p2', userId: 'user-1' }, NOW)).rejects.toBeInstanceOf(
      ProofVerificationError,
    );
    await expect(proofs.verifyProof({ proofId: 'p2', userId: 'user-2' }, NOW)).rejects.toBeInstanceOf(
      ProofVerificationError,
    );
  });
});

describe('invitations', () => {
  it('should issue single-use sit_ tokens consumed atomically at registration', async () => {
    const { invitations } = setup();
    const invitation = await invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', tenantId: 'tenant-1', expiresAt: LATER },
      'admin',
    );
    expect(invitation.token.startsWith('sit_')).toBe(true);
    const result = await invitations.consumeInvitation(invitation.token, NOW);
    expect(result.emailVerified).toBe(true);
    expect(result.invitation.status).toBe('consumed');
    await expect(invitations.consumeInvitation(invitation.token, NOW)).rejects.toBeInstanceOf(
      InvitationError,
    );
  });

  it('should refuse expired, revoked and unknown tokens with distinct reasons', async () => {
    const { invitations } = setup();
    const expired = await invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', expiresAt: NOW },
      'admin',
    );
    await expect(invitations.consumeInvitation(expired.token, LATER)).rejects.toMatchObject({
      code: 'invitation_invalid',
      reason: 'expired',
    });
    const revoked = await invitations.issueInvitation(
      { invitationId: 'inv-2', email: 'c@example.com', expiresAt: LATER },
      'admin',
    );
    await invitations.revokeInvitation('inv-2', 'admin');
    await expect(invitations.consumeInvitation(revoked.token, NOW)).rejects.toMatchObject({
      reason: 'revoked',
    });
    await expect(invitations.consumeInvitation('sit_unknown', NOW)).rejects.toMatchObject({
      reason: 'not_found',
    });
  });
});

describe('login sessions', () => {
  it('should create, validate, refresh and revoke a session', async () => {
    const { sessions } = setup();
    await sessions.createSession(
      { sessionId: 's1', userId: 'user-1', mfaState: 'none' },
      { now: NOW, ttlSeconds: 3600 },
    );
    expect((await sessions.validateSession('s1', NOW)).status).toBe('active');
    const refreshed = await sessions.refreshSession('s1', { now: NOW, ttlSeconds: 3600 });
    expect(refreshed.refreshCount).toBe(1);
    await sessions.revokeSession('s1', 'user-1');
    await expect(sessions.validateSession('s1', NOW)).rejects.toMatchObject({ reason: 'revoked' });
  });

  it('should expire sessions past their ttl and revoke all sessions of a user', async () => {
    const { sessions } = setup();
    await sessions.createSession(
      { sessionId: 's1', userId: 'user-1' },
      { now: NOW, ttlSeconds: 3600 },
    );
    await sessions.createSession(
      { sessionId: 's2', userId: 'user-1' },
      { now: NOW, ttlSeconds: 3600 },
    );
    await expect(sessions.validateSession('s1', '2026-10-31T12:00:00.000Z')).rejects.toMatchObject({
      reason: 'expired',
    });
    expect(await sessions.revokeAllSessionsForUser('user-1', 'admin')).toBe(2);
    expect(await sessions.listSessionsForUser('user-1')).toHaveLength(2);
    await expect(sessions.validateSession('s2', NOW)).rejects.toBeInstanceOf(LoginSessionError);
  });
});
