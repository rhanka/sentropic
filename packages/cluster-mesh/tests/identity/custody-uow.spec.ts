import { describe, expect, it } from 'vitest';
import type { IdentityTransactionV1, CustodyOpHost } from '../../src/index.js';
import { createPostgresIdentityUnitOfWorkV1, createSqliteIdentityUnitOfWorkV1, bindPostgresIdentityTransactionV1, bindSqliteIdentityTransactionV1 } from '../../src/index.js';
import { assertIdentityTransactionActive } from '../../src/storage/identity/custody-transaction-guards.js';
import type { PgSession } from '../../src/storage/postgres/protocol.js';
import type { SqliteConnection } from '../../src/storage/sqlite/connection.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv } from './a20b-helpers.js';

const WRITE = { mode: 'write', purpose: 'request', deadlineMs: 5000, maxAttempts: 1 } as const;
const READ = { ...WRITE, mode: 'read' } as const;
const account = { userId: 'combined', email: 'combined@example.test', accountStatus: 'active', globalRole: 'editor', createdAt: NOW, updatedAt: NOW } as const;
const profile = { userId: 'combined', emailVerified: true, displayName: null, approvalDueAt: null, approvedAt: null, approvedByUserId: null, disabledAt: null, disabledReason: null, legacyAccountStatus: null };

describe.each(process.env.CM_PG_URL ? ['postgres', 'sqlite'] : ['sqlite'])('A2.0b combined UOW on %s', (dialect) => {
  const open = async () => asOpHost((dialect === 'postgres' ? await openPostgresEnv() : openSqliteEnv()).unitOfWork);

  it('preserves a host-owned business facade in both exported transaction factories', async () => {
    const uow = await open();
    await uow.run(WRITE, async (tx) => {
      const facade = { business: true };
      const base = { transactionId: tx.transactionId, readOnly: false, hostTransaction: facade };
      if (dialect === 'postgres') {
        const binding = { ...base, session: tx.hostTransaction.raw as PgSession };
        const joined = createPostgresIdentityUnitOfWorkV1({ schema: tx.hostTransaction.schema!, host: { runSerializable: async (_, operation) => operation(binding) } });
        await joined.run(WRITE, async (inner) => { expect(inner.hostTransaction).toBe(facade); });
        const bound = bindPostgresIdentityTransactionV1({ schema: tx.hostTransaction.schema!, binding });
        expect(bound.hostTransaction).toBe(facade);
        expect(() => assertIdentityTransactionActive(bound, true)).not.toThrow();
      } else {
        const binding = { ...base, connection: tx.hostTransaction.raw as SqliteConnection };
        const joined = createSqliteIdentityUnitOfWorkV1({ host: { runExclusiveTransaction: async (_, operation) => operation(binding) } });
        await joined.run(WRITE, async (inner) => { expect(inner.hostTransaction).toBe(facade); });
        const bound = bindSqliteIdentityTransactionV1({ binding });
        expect(bound.hostTransaction).toBe(facade);
        expect(() => assertIdentityTransactionActive(bound, true)).not.toThrow();
      }
    });
  });

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
    await expect(escaped!.hostTransaction.stores.profiles.find(account.userId)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    await uow.run(READ, async (tx) => {
      expect(await tx.stores.accounts.findAccount(account.userId)).toBeNull();
      expect(await tx.custody.profiles.find(account.userId)).toBeNull();
      await expect(tx.lockSubject(account.userId)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
      await expect(tx.hostTransaction.journal.insertAccountCore(account)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
      await expect(tx.custody.subjects.register(account, profile)).rejects.toMatchObject({ code: 'identity_transaction_unbound' });
    });
  });
});
