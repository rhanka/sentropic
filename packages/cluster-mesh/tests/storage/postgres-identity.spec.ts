// A2.1 durable round-trips on the PostgreSQL hosted profile (CI postgres
// lane, CM_PG_URL): frozen domains over durable stores in a fresh control
// schema per test, including exactly-once invitation consume under
// concurrency, revoke-all effectiveness and a driver-pool restart.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pgEnabled, testPgDriver } from './pg-driver.js';
import type { InjectedPgDriver } from '../../src/storage/postgres/protocol.js';
import {
  createPostgresIdentityStores,
  InvitationError,
  LoginSessionError,
  wireIdentityDomains,
  type IdentityDomainSlice,
} from '../../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-31T12:00:00.000Z';
const SOON = '2026-10-30T12:30:00.000Z';
const CLOCK = (): string => NOW;

interface Resources {
  readonly driver: InjectedPgDriver;
  close(): Promise<void>;
}

const schemas: string[] = [];
const pools: { close(): Promise<void> }[] = [];

const freshDriver = (): Resources => {
  const { driver, close } = testPgDriver();
  pools.push({ close });
  return { driver, close };
};

const freshStores = (driver: InjectedPgDriver) => {
  const schema = `identity_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  schemas.push(schema);
  return { schema, stores: createPostgresIdentityStores({ driver, schema }) };
};

const domains = (driver: InjectedPgDriver): IdentityDomainSlice => {
  const { stores } = freshStores(driver);
  return wireIdentityDomains({ stores, clock: CLOCK });
};

const registerApprovalLogin = async (slice: IdentityDomainSlice): Promise<void> => {
  await slice.accounts.register({ userId: 'user-1', email: 'a@example.com' });
  await slice.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
  await slice.loginSessions.createSession({ sessionId: 'session-1', userId: 'user-1' }, { now: NOW, ttlSeconds: 3600 });
};

describe.skipIf(!pgEnabled)('PostgreSQL identity storage (A2.1)', () => {
  let driver: InjectedPgDriver;

  beforeAll(() => {
    driver = freshDriver().driver;
  });

  afterAll(async () => {
    for (const schema of schemas.splice(0)) {
      await driver
        .transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 5000 }, async (session) => {
          await session.execute({ text: `DROP SCHEMA IF EXISTS "${schema}" CASCADE`, values: [] });
        })
        .catch(() => undefined);
    }
    for (const pool of pools.splice(0)) await pool.close().catch(() => undefined);
  });

  it('should carry registration, approval and login from the same durable stores', async () => {
    const slice = domains(driver);
    await registerApprovalLogin(slice);

    const pending = await slice.accounts.register({ userId: 'user-2', email: 'b@example.com' });
    expect(pending.accountStatus).toBe('pending_admin_approval');
    const approved = await slice.accounts.approveAccount('user-2', { role: 'guest', actorId: 'admin' });
    expect(approved).toMatchObject({ accountStatus: 'active', globalRole: 'guest' });

    const session = await slice.loginSessions.validateSession('session-1', SOON);
    expect(session).toMatchObject({ sessionId: 'session-1', userId: 'user-1', status: 'active', refreshCount: 0 });
    const refreshed = await slice.loginSessions.refreshSession('session-1', { now: SOON, ttlSeconds: 3600 });
    expect(refreshed.refreshCount).toBe(1);
    expect(await slice.accounts.listUsers()).toHaveLength(2);
  });

  it('should consume a pending invitation exactly once under concurrency', async () => {
    const slice = domains(driver);
    await slice.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    const invitation = await slice.invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', expiresAt: LATER },
      'admin',
    );

    const outcomes = await Promise.allSettled(
      Array.from({ length: 8 }, () => slice.invitations.consumeInvitation(invitation.token, NOW)),
    );
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(refused).toHaveLength(7);
    for (const outcome of refused) {
      expect(outcome.reason).toBeInstanceOf(InvitationError);
      expect((outcome.reason as InvitationError).reason).toBe('consumed');
    }
    await expect(slice.invitations.consumeInvitation(invitation.token, NOW)).rejects.toMatchObject({
      code: 'invitation_invalid',
      reason: 'consumed',
    });
  });

  it('should make revoke-all effective for the next session validation', async () => {
    const slice = domains(driver);
    await registerApprovalLogin(slice);
    await slice.loginSessions.createSession({ sessionId: 'session-2', userId: 'user-1' }, { now: NOW, ttlSeconds: 3600 });

    expect(await slice.loginSessions.revokeAllSessionsForUser('user-1', 'admin')).toBe(2);
    await expect(slice.loginSessions.validateSession('session-1', NOW)).rejects.toMatchObject({
      code: 'login_session_invalid',
      reason: 'revoked',
    });
    await expect(slice.loginSessions.validateSession('session-2', NOW)).rejects.toBeInstanceOf(LoginSessionError);
    expect(await slice.loginSessions.revokeAllSessionsForUser('user-1', 'admin')).toBe(0);
  });

  it('should persist identity state across a driver-pool restart', async () => {
    const first = freshStores(driver);
    const firstSlice = wireIdentityDomains({ stores: first.stores, clock: CLOCK });
    await registerApprovalLogin(firstSlice);
    const invitation = await firstSlice.invitations.issueInvitation(
      { invitationId: 'inv-1', email: 'b@example.com', expiresAt: LATER },
      'admin',
    );
    await firstSlice.invitations.consumeInvitation(invitation.token, NOW);

    const restart = freshDriver();
    const reopened = createPostgresIdentityStores({ driver: restart.driver, schema: first.schema });
    const secondSlice = wireIdentityDomains({ stores: reopened, clock: CLOCK });
    expect(await secondSlice.loginSessions.validateSession('session-1', SOON)).toMatchObject({ status: 'active' });
    const account = await secondSlice.accounts.getAccount('user-1');
    expect(account).toMatchObject({ accountStatus: 'active', globalRole: 'editor' });
    await expect(secondSlice.invitations.consumeInvitation(invitation.token, NOW)).rejects.toMatchObject({
      reason: 'consumed',
    });
  });

  it('should approve a device code exactly once and expose it to polls', async () => {
    const slice = domains(driver);
    await slice.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await slice.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    const issuance = await slice.deviceEnrolment.issueDeviceCode(
      { deviceName: 'laptop' },
      { now: NOW, ttlSeconds: 600, intervalSec: 5 },
    );

    expect(await slice.deviceEnrolment.pollDeviceCode(issuance.deviceCode, NOW)).toMatchObject({
      status: 'authorization_pending',
    });
    const approved = await slice.deviceEnrolment.approveDeviceCode(issuance.userCode, { userId: 'user-1' }, NOW);
    expect(approved).toMatchObject({ status: 'approved', approvedUserId: 'user-1' });
    expect(await slice.deviceEnrolment.pollDeviceCode(issuance.deviceCode, NOW)).toMatchObject({
      status: 'approved',
      userId: 'user-1',
      deviceName: 'laptop',
    });
    await expect(
      slice.deviceEnrolment.approveDeviceCode(issuance.userCode, { userId: 'user-1' }, NOW),
    ).rejects.toMatchObject({ code: 'device_code_invalid', reason: 'already_resolved' });
  });

  it('should refuse expired sessions after the durable round-trip', async () => {
    const slice = domains(driver);
    await slice.accounts.register({ userId: 'user-1', email: 'a@example.com' });
    await slice.accounts.approveAccount('user-1', { role: 'editor', actorId: 'admin' });
    await slice.loginSessions.createSession({ sessionId: 'session-1', userId: 'user-1' }, { now: NOW, ttlSeconds: 60 });
    await expect(slice.loginSessions.validateSession('session-1', SOON)).rejects.toMatchObject({
      code: 'login_session_invalid',
      reason: 'expired',
    });
  });
});
