// A2.0b atomic person deletion: idempotency, operation race, both handlers,
// guard rails, plan validation and injected-failure rollback.

import { describe, expect, it } from 'vitest';
import type { BusinessDeletionPlanV1, IdentityTransactionV1, IdentityUnitOfWorkV1 } from '../../src/index.js';
import {
  AdminUserProtectedError,
  IdentityConflictError,
  IdentityNotFoundError,
  SelfActionForbiddenError,
} from '../../src/index.js';
import { createAtomicPersonDeletionV2 } from '../../src/index.js';
import { asOpHost, createFixtureBusiness, LATER, NOW, openPostgresEnv, openSqliteEnv, sha256Hex, type FixtureBusinessState } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 5000 };
const DELETE_OPTS = { mode: 'delete' as const, deadlineMs: 8000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly concurrent: boolean;
}

const seedAccount = async (host: CustodyOpHost, userId: string, status: 'active' | 'disabled', role: 'editor' | 'admin_app' = 'editor'): Promise<void> => {
  await host.journal.insertAccountCore({ userId, email: `${userId}@example.test`, accountStatus: status, globalRole: role, createdAt: NOW, updatedAt: NOW });
  await host.journal.ensureLiveFence(userId, NOW);
};

const seedWorkspace = async (host: CustodyOpHost, workspaceId: string, members: readonly { readonly userId: string; readonly role: string }[]): Promise<void> => {
  await host.journal.insertTenantCore({ tenantId: 'org', slug: 'org', status: 'active', createdAt: NOW });
  await host.journal.insertWorkspaceCore({ workspaceId, tenantId: 'org', repoIdentity: null, aliases: [], enrolledAt: NOW });
  for (const member of members) {
    await host.journal.insertWorkspaceMemberCore({ workspaceId, userId: member.userId, role: member.role });
  }
};

describe.each([{ profile: 'postgres' }, { profile: 'sqlite' }])('A2.0b atomic person deletion on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') return { unitOfWork: asOpHost((await openPostgresEnv()).unitOfWork), concurrent: true };
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork), concurrent: false };
  };

  it('returns the committed receipt for a repeated operation id', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: ['ws'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
      await seedWorkspace(tx.hostTransaction, 'ws', [{ userId: 'marie', role: 'member' }]);
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: env.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    const command = { userId: 'marie', actorId: 'admin', handlerId: 'admin_account' as const, operationId: 'op-repeat' };
    const first = await deletion.deletePerson(command);
    expect(first.transaction).toBe('committed');
    const second = await deletion.deletePerson(command);
    expect(second).toEqual(first);
    expect(state.reachedDelete).toBe(true);
  });

  it('refuses a conflicting command under a reused operation id', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: [] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: env.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    await deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-conflict' });
    await expect(deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'self_account', operationId: 'op-conflict' })).rejects.toMatchObject({ code: 'identity_operation_conflict' });
  });

  it('deletes through the self handler and refuses foreign actors', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: [] };
    const fixture = createFixtureBusiness({ handlerId: 'self_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: env.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    await expect(deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'self_account', operationId: 'op-self-x' })).rejects.toBeInstanceOf(SelfActionForbiddenError);
    expect(await deletion.getOperation('op-self-x')).toBeNull();
    const receipt = await deletion.deletePerson({ userId: 'marie', actorId: 'marie', handlerId: 'self_account', operationId: 'op-self' });
    expect(receipt.transaction).toBe('committed');
    expect(receipt.resultCode).toBe('identity_deleted');
  });

  it('protects admin accounts, unknown subjects and last admins', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: ['ws'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin2', 'disabled', 'admin_app');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
      await seedWorkspace(tx.hostTransaction, 'ws', [{ userId: 'marie', role: 'admin' }]);
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: env.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    await expect(deletion.deletePerson({ userId: 'admin2', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-admin2' })).rejects.toBeInstanceOf(AdminUserProtectedError);
    await expect(deletion.deletePerson({ userId: 'ghost', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-ghost' })).rejects.toBeInstanceOf(IdentityNotFoundError);
    // Sole admin of a retained workspace: the deletion tx refuses, nothing mutates.
    const rolled = await deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-last-admin' });
    expect(rolled.transaction).toBe('rolled_back');
    expect(await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.journal.findAccountCore('marie'))).not.toBeNull();
    expect(await deletion.getOperation('op-last-admin')).toMatchObject({ state: 'queued' });
  });

  it('rolls back business rows when the orphan assertion fails', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: 'assert', reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: ['ws'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
      await seedWorkspace(tx.hostTransaction, 'ws', [{ userId: 'marie', role: 'member' }]);
      await fixture.setup(tx.hostTransaction, [{ ownerId: 'marie', workspaceId: 'ws', payload: 'doc' }]);
    });
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: env.unitOfWork, business: fixture.business, deletionOptions: DELETE_OPTS });
    const receipt = await deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-assert' });
    expect(state.reachedDelete).toBe(true);
    expect(state.reachedAssert).toBe(true);
    expect(receipt.transaction).toBe('rolled_back');
    expect(receipt.steps).toContainEqual({ step: 'account', outcome: 'queued', detail: 'required_local_step_failed' });
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findAccountCore('marie')).not.toBeNull();
      expect(await fixture.rows(tx.hostTransaction)).toHaveLength(1);
      expect(await tx.hostTransaction.journal.listWorkspaceIdsForUser('marie')).toEqual(['ws']);
    });
  });

  it('rolls back when the login-sessions step fails after reservation', async () => {
    const env = await openEnv();
    const state: FixtureBusinessState = { failAt: null, reachedDelete: false, reachedAssert: false };
    const plan: BusinessDeletionPlanV1 = { userId: 'marie', workspaceIdsToDelete: [], retainedWorkspaceIds: ['ws'] };
    const fixture = createFixtureBusiness({ handlerId: 'admin_account', plan, state });
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await seedAccount(tx.hostTransaction, 'marie', 'disabled');
      await seedAccount(tx.hostTransaction, 'admin', 'active');
      await seedWorkspace(tx.hostTransaction, 'ws', [{ userId: 'marie', role: 'member' }]);
      await tx.hostTransaction.stores.sessions.insert({
        sessionId: 'sess-x', userId: 'marie', sessionTokenHash: sha256Hex('sess-x'), refreshTokenHash: null,
        login: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
        rotationVersion: 0, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: null, ipAddress: null, userAgent: null, lastActivityAt: null,
      });
    });
    let failureReached = false;
    const proxied: IdentityUnitOfWorkV1<CustodyOpHost> = {
      ...env.unitOfWork,
      runWrite: (options, operation) =>
        env.unitOfWork.runWrite(options, (tx: IdentityTransactionV1<CustodyOpHost>) => {
          const proxiedHost = new Proxy(tx.hostTransaction, {
            get(target, property, receiver) {
              if (property === 'stores') {
                const stores = (target as CustodyOpHost).stores;
                return new Proxy(stores, {
                  get(storesTarget, storesProperty, storesReceiver) {
                    if (storesProperty === 'sessions') {
                      const sessions = (storesTarget as CustodyOpHost['stores']).sessions;
                      return new Proxy(sessions, {
                        get(sessionsTarget, sessionsProperty, sessionsReceiver) {
                          if (sessionsProperty === 'revokeAllForUser') {
                            return async (): Promise<number> => {
                              failureReached = true;
                              throw new Error('injected-sessions');
                            };
                          }
                          return Reflect.get(sessionsTarget as object, sessionsProperty as string, sessionsReceiver);
                        },
                      });
                    }
                    return Reflect.get(storesTarget as object, storesProperty as string, storesReceiver);
                  },
                });
              }
              return Reflect.get(target as object, property as string, receiver);
            },
          });
          return operation({ ...tx, hostTransaction: proxiedHost as CustodyOpHost });
        }),
    };
    const deletion = createAtomicPersonDeletionV2({ unitOfWork: proxied, business: fixture.business, deletionOptions: DELETE_OPTS });
    const receipt = await deletion.deletePerson({ userId: 'marie', actorId: 'admin', handlerId: 'admin_account', operationId: 'op-sessions' });
    expect(failureReached).toBe(true);
    expect(receipt.transaction).toBe('rolled_back');
    expect(receipt.steps).toContainEqual({ step: 'login_sessions', outcome: 'queued', detail: 'required_local_step_failed' });
    await env.unitOfWork.runRead(READ, async (tx) => {
      expect(await tx.hostTransaction.journal.findAccountCore('marie')).not.toBeNull();
      expect(await tx.hostTransaction.stores.sessions.listForUser('marie')).toHaveLength(1);
    });
  });
});
