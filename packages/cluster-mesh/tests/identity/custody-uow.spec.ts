import { describe, expect, it } from 'vitest';
import type { IdentityTransactionV1, CustodyOpHost } from '../../src/index.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv } from './a20b-helpers.js';

const WRITE = { mode: 'write', purpose: 'request', deadlineMs: 5000, maxAttempts: 1 } as const;
const READ = { ...WRITE, mode: 'read' } as const;
const account = { userId: 'combined', email: 'combined@example.test', accountStatus: 'active', globalRole: 'user', createdAt: NOW, updatedAt: NOW } as const;
const profile = { userId: 'combined', emailVerified: true, displayName: null, approvalDueAt: null, approvedAt: null, approvedByUserId: null, disabledAt: null, disabledReason: null, legacyAccountStatus: null };

describe.each(process.env.CM_PG_URL ? ['postgres', 'sqlite'] : ['sqlite'])('A2.0b combined UOW on %s', (dialect) => {
  const open = async () => asOpHost((dialect === 'postgres' ? await openPostgresEnv() : openSqliteEnv()).unitOfWork);

  it('binds core, custody, locks, ledger, journal and outbox to one callback', async () => {
    const uow = await open();
    await uow.run(WRITE, async (tx) => {
      expect(tx.mode).toBe('write');
      expect(tx.profile).toBe(dialect);
      await tx.custody.subjects.register(account, profile);
      await tx.lockSubject(account.userId);
      await tx.lockEmail(account.email);
      expect(await tx.stores.accounts.findAccount(account.userId)).toEqual(account);
      expect(await tx.custody.profiles.find(account.userId)).toEqual(profile);
      expect(typeof tx.lockWorkspace).toBe('function');
      expect(typeof tx.cleanup.assertNoLiveReferences).toBe('function');
      expect(typeof tx.deletionJournal.reserve).toBe('function');
      expect(typeof tx.revocationOutbox.enqueue).toBe('function');
      await tx.ledger.append({ at: NOW, kind: 'combined.created', subjectId: account.userId });
    });
    await uow.run(READ, async (tx) => {
      expect(await tx.stores.accounts.findAccount(account.userId)).toEqual(account);
      expect(await tx.custody.profiles.find(account.userId)).toEqual(profile);
    });
  });

  it('rolls back all participants and rejects writes through read or expired handles', async () => {
    const uow = await open();
    let escaped: IdentityTransactionV1<CustodyOpHost> | undefined;
    await expect(uow.run(WRITE, async (tx) => {
      escaped = tx;
      await tx.custody.subjects.register(account, profile);
      await tx.ledger.append({ at: NOW, kind: 'combined.rollback', subjectId: account.userId });
      throw new Error('rollback-probe');
    })).rejects.toThrow('rollback-probe');
    await expect(escaped!.custody.profiles.find(account.userId)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    await uow.run(READ, async (tx) => {
      expect(await tx.stores.accounts.findAccount(account.userId)).toBeNull();
      expect(await tx.custody.profiles.find(account.userId)).toBeNull();
      await expect(tx.lockSubject(account.userId)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
      await expect(tx.custody.subjects.register(account, profile)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    });
  });
});
