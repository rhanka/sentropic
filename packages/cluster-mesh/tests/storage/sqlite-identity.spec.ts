// A2.1 durable round-trips on the SQLite local profile: the frozen domains
// wired onto durable stores, including the exactly-once invitation consume
// under concurrency, revoke-all effectiveness and close/reopen persistence.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DeviceCodeError,
  InvitationError,
  LoginSessionError,
  openSqliteIdentityStores,
  wireIdentityDomains,
  type IdentityDomainSlice,
} from '../../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-31T12:00:00.000Z';
const SOON = '2026-10-30T12:30:00.000Z';
const CLOCK = (): string => NOW;

interface Slice {
  readonly domains: IdentityDomainSlice;
  readonly path: string;
  close(): void;
}

const live: { readonly dir: string; close(): void }[] = [];
const dispose = (entry: { readonly dir: string; close(): void }): void => {
  try {
    entry.close();
  } catch {
    // already closed by the test (reopen scenario)
  }
  rmSync(entry.dir, { recursive: true, force: true });
};
afterAll(() => {
  for (const entry of live.splice(0)) dispose(entry);
});

const openSlice = (): Slice => {
  const dir = mkdtempSync(join(tmpdir(), 'cm-identity-'));
  const path = join(dir, 'identity.db');
  const handle = openSqliteIdentityStores({ path, moduleId: 'identity-a2-1' });
  const domains = wireIdentityDomains({ stores: handle.stores, clock: CLOCK });
  const slice: Slice = { domains, path, close: (): void => handle.close() };
  live.push({ dir, close: (): void => handle.close() });
  return slice;
};

const registerApprovalLogin = async (domains: IdentityDomainSlice): Promise<void> => {
  await domains.accounts.register({ userId: 'user-1', email: 'a@example.com' });
  await domains.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
  await domains.loginSessions.createSession({ sessionId: 'session-1', userId: 'user-1' }, { now: NOW, ttlSeconds: 3600 });
};

describe('SQLite identity storage (A2.1)', () => {
  it('should carry registration, approval and login from the same durable stores', async () => {
    const { domains } = openSlice();
    await registerApprovalLogin(domains);

    const pending = await domains.accounts.register({ userId: 'user-2', email: 'b@example.com' });
    expect(pending.accountStatus).toBe('pending_admin_approval');
    const approved = await domains.accounts.approveAccount('user-2', { role: 'guest', actorId: 'admin' });
    expect(approved).toMatchObject({ accountStatus: 'active', globalRole: 'guest' });

    const session = await domains.loginSessions.validateSession('session-1', SOON);
    expect(session).toMatchObject({ sessionId: 'session-1', userId: 'user-1', status: 'active', refreshCount: 0 });
    const refreshed = await domains.loginSessions.refreshSession('session-1', { now: SOON, ttlSeconds: 3600 });
    expect(refreshed.refreshCount).toBe(1);
    expect(await domains.accounts.listUsers()).toHaveLength(2);
  });

  it('should consume a pending invitation exactly once under concurrency', async () => {
    const { domains } = openSlice();
    await domains.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    const invitation = await domains.invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', expiresAt: LATER },
      'admin',
    );

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => domains.invitations.consumeInvitation(invitation.token, NOW)),
    );
    const consumed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(consumed).toHaveLength(1);
    expect(refused).toHaveLength(7);
    for (const outcome of refused) {
      expect(outcome.reason).toBeInstanceOf(InvitationError);
      expect((outcome.reason as InvitationError).reason).toBe('consumed');
    }
    await expect(domains.invitations.consumeInvitation(invitation.token, NOW)).rejects.toMatchObject({
      code: 'invitation_invalid',
      reason: 'consumed',
    });
  });

  it('should make revoke-all effective for the next session validation', async () => {
    const { domains } = openSlice();
    await registerApprovalLogin(domains);
    await domains.loginSessions.createSession({ sessionId: 'session-2', userId: 'user-1' }, { now: NOW, ttlSeconds: 3600 });

    expect(await domains.loginSessions.revokeAllSessionsForUser('user-1', 'admin')).toBe(2);
    await expect(domains.loginSessions.validateSession('session-1', NOW)).rejects.toMatchObject({
      code: 'login_session_invalid',
      reason: 'revoked',
    });
    await expect(domains.loginSessions.validateSession('session-2', NOW)).rejects.toMatchObject({ reason: 'revoked' });
    expect(await domains.loginSessions.revokeAllSessionsForUser('user-1', 'admin')).toBe(0);
  });

  it('should persist identity state across close and reopen', async () => {
    const first = openSlice();
    await registerApprovalLogin(first.domains);
    const invitation = await first.domains.invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', expiresAt: LATER },
      'admin',
    );
    await first.domains.invitations.consumeInvitation(invitation.token, NOW);
    first.close();

    const reopened = openSqliteIdentityStores({ path: first.path, moduleId: 'identity-a2-1' });
    live.push({ dir: dirname(first.path), close: (): void => reopened.close() });
    const domains = wireIdentityDomains({ stores: reopened.stores, clock: CLOCK });
    expect(await domains.loginSessions.validateSession('session-1', SOON)).toMatchObject({ status: 'active' });
    const account = await domains.accounts.getAccount('user-1');
    expect(account).toMatchObject({ accountStatus: 'active', globalRole: 'editor' });
    await expect(domains.invitations.consumeInvitation(invitation.token, NOW)).rejects.toMatchObject({
      reason: 'consumed',
    });
  });

  it('should approve a device code exactly once and expose it to polls', async () => {
    const { domains } = openSlice();
    await domains.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await domains.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    const issuance = await domains.deviceEnrolment.issueDeviceCode(
      { deviceName: 'laptop' },
      { now: NOW, ttlSeconds: 600, intervalSec: 5 },
    );

    expect(await domains.deviceEnrolment.pollDeviceCode(issuance.deviceCode, NOW)).toMatchObject({
      status: 'authorization_pending',
    });
    const approved = await domains.deviceEnrolment.approveDeviceCode(
      issuance.userCode,
      { userId: 'user-1' },
      NOW,
    );
    expect(approved).toMatchObject({ status: 'approved', approvedUserId: 'user-1' });
    expect(await domains.deviceEnrolment.pollDeviceCode(issuance.deviceCode, NOW)).toMatchObject({
      status: 'approved',
      userId: 'user-1',
      deviceName: 'laptop',
    });
    await expect(
      domains.deviceEnrolment.approveDeviceCode(issuance.userCode, { userId: 'user-1' }, NOW),
    ).rejects.toBeInstanceOf(DeviceCodeError);
  });

  it('should keep expired sessions unusable after durability round-trip', async () => {
    const { domains } = openSlice();
    await domains.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await domains.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    await domains.loginSessions.createSession({ sessionId: 'session-1', userId: 'user-1' }, { now: NOW, ttlSeconds: 60 });
    await expect(domains.loginSessions.validateSession('session-1', SOON)).rejects.toBeInstanceOf(LoginSessionError);
  });
});
