// A2.3 spec: the F14 person revocation composition over the frozen cascade.
// Receipts enumerate every step of the frozen union, a partial failure is
// left queued and visible while the remaining steps still run, and the
// agent-plane step flips from queued to applied only when M4 binds the port.

import { describe, expect, it } from 'vitest';
import {
  InMemoryIdentityLedger,
  createInMemoryIdentityStores,
  createPersonRevocation,
} from '../src/index.js';

const NOW = '2026-10-30T12:00:00.000Z';

const STEP_ORDER = [
  'login_sessions',
  'remote_reader_sessions',
  'connector_grants',
  'tenant_memberships',
  'agent_plane',
  'purpose_grants',
  'catalogue',
  'account',
] as const;

async function setup() {
  const stores = createInMemoryIdentityStores();
  const ledger = new InMemoryIdentityLedger();
  const revocation = createPersonRevocation({
    accounts: stores.accounts,
    sessions: stores.sessions,
    memberships: stores.memberships,
    ledger,
    clock: () => NOW,
  });
  await stores.accounts.createAccount({
    userId: 'user-1',
    email: 'user-1@example.com',
    accountStatus: 'active',
    globalRole: 'editor',
    createdAt: NOW,
    updatedAt: NOW,
  });
  for (const sessionId of ['sess-1', 'sess-2']) {
    await stores.sessions.createSession({
      sessionId,
      userId: 'user-1',
      status: 'active',
      mfaState: 'none',
      createdAt: NOW,
      expiresAt: '2026-10-30T13:00:00.000Z',
      refreshCount: 0,
    });
  }
  await stores.memberships.upsertMembershipRequest({
    userId: 'user-1',
    tenantId: 'tenant-1',
    status: 'approved',
    tenantRole: 'member',
    decidedBy: 'admin-1',
    decidedAt: NOW,
    updatedAt: NOW,
  });
  await stores.memberships.upsertMembershipRequest({
    userId: 'user-1',
    tenantId: 'tenant-2',
    status: 'invited',
    tenantRole: 'member',
    decidedAt: NOW,
    updatedAt: NOW,
  });
  return { stores, ledger, revocation };
}

describe('person revocation cascade (F14)', () => {
  it('should enumerate every step of the frozen union in order on disable', async () => {
    const { revocation } = await setup();
    const receipt = await revocation.revokePerson('user-1', 'disable', { actorId: 'admin-1' });
    expect(receipt.steps.map((step) => step.step)).toEqual(STEP_ORDER);
    expect(receipt.userId).toBe('user-1');
    expect(receipt.mode).toBe('disable');
    expect(receipt.at).toBe(NOW);
  });

  it('should apply the bound steps and leave unbound planes queued or not applicable', async () => {
    const { stores, revocation } = await setup();
    const receipt = await revocation.revokePerson('user-1', 'disable', { actorId: 'admin-1' });
    const byStep = Object.fromEntries(receipt.steps.map((step) => [step.step, step]));
    expect(byStep.login_sessions).toMatchObject({ outcome: 'applied', detail: '2 sessions revoked' });
    expect(byStep.remote_reader_sessions).toMatchObject({ outcome: 'not_applicable' });
    expect(byStep.connector_grants).toMatchObject({ outcome: 'not_applicable' });
    expect(byStep.tenant_memberships).toMatchObject({ outcome: 'applied', detail: '1 memberships suspended' });
    expect(byStep.agent_plane).toMatchObject({ outcome: 'queued' });
    expect(byStep.purpose_grants).toMatchObject({ outcome: 'not_applicable' });
    expect(byStep.catalogue).toMatchObject({ outcome: 'not_applicable' });
    expect(byStep.account).toMatchObject({ outcome: 'applied', detail: 'account disabled' });
    const account = await stores.accounts.findAccount('user-1');
    expect(account).toMatchObject({ accountStatus: 'disabled' });
    const sessions = await stores.sessions.listSessionsForUser('user-1');
    expect(sessions.every((session) => session.status === 'revoked')).toBe(true);
    const membership = await stores.memberships.findMembership('user-1', 'tenant-1');
    expect(membership).toMatchObject({ status: 'suspended' });
  });

  it('should audit the revocation into the durable ledger', async () => {
    const { ledger, revocation } = await setup();
    await revocation.revokePerson('user-1', 'disable', { actorId: 'admin-1' });
    const events = await ledger.listAuditEvents();
    expect(events).toContainEqual({
      at: NOW,
      kind: 'person.revoked.disable',
      actorId: 'admin-1',
      subjectId: 'user-1',
    });
  });

  it('should delete the account in delete mode', async () => {
    const { stores, revocation } = await setup();
    const receipt = await revocation.revokePerson('user-1', 'delete', { actorId: 'admin-1' });
    expect(receipt.steps.at(-1)).toMatchObject({ step: 'account', outcome: 'applied', detail: 'account deleted' });
    expect(await stores.accounts.findAccount('user-1')).toBeNull();
  });

  it('should apply the agent-plane step when the M4 port is bound', async () => {
    const { stores, ledger } = await setup();
    const revocation = createPersonRevocation({
      accounts: stores.accounts,
      sessions: stores.sessions,
      memberships: stores.memberships,
      ledger,
      agentPlane: {
        closeAgentSessionsForUser: async () => 3,
      },
      clock: () => NOW,
    });
    const receipt = await revocation.revokePerson('user-1', 'disable', { actorId: 'admin-1' });
    expect(receipt.steps.find((step) => step.step === 'agent_plane')).toMatchObject({
      outcome: 'applied',
      detail: '3 agent sessions closed',
    });
  });

  it('should leave an injected step failure queued and visible while later steps still run', async () => {
    const { stores, ledger } = await setup();
    const failingSessions = {
      ...stores.sessions,
      revokeAllSessionsForUser: async () => {
        throw new Error('session store offline');
      },
    };
    const revocation = createPersonRevocation({
      accounts: stores.accounts,
      sessions: failingSessions,
      memberships: stores.memberships,
      ledger,
      clock: () => NOW,
    });
    const receipt = await revocation.revokePerson('user-1', 'disable', { actorId: 'admin-1' });
    const loginStep = receipt.steps.find((step) => step.step === 'login_sessions');
    expect(loginStep).toMatchObject({ outcome: 'queued' });
    expect(String(loginStep?.detail)).toContain('session store offline');
    const accountStep = receipt.steps.at(-1);
    expect(accountStep).toMatchObject({ step: 'account', outcome: 'applied', detail: 'account disabled' });
    const events = await ledger.listAuditEvents();
    expect(events.some((event) => event.kind === 'person.revoked.disable')).toBe(true);
  });

  it('should leave the account step queued when the account is unknown', async () => {
    const { revocation } = await setup();
    const receipt = await revocation.revokePerson('user-ghost', 'disable', { actorId: 'admin-1' });
    expect(receipt.steps.find((step) => step.step === 'account')).toMatchObject({ outcome: 'queued' });
    expect(receipt.steps.find((step) => step.step === 'login_sessions')).toMatchObject({
      outcome: 'applied',
      detail: '0 sessions revoked',
    });
  });
});
