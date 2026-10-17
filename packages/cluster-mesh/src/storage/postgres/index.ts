import { openPgCore } from './core.js';
import { PgScoped } from './scope.js';
import { ownPgValue } from './ordinary-transactions.js';
import type { ScopeGrant } from '../authority.js';
import type { WriterFence } from '../contracts.js';
import type { PostgresStorageOptions } from './protocol.js';
import { recoverPgStaged, type PgRecoveryRequest } from './recovery.js';
export const createPostgresKernel = async (options: PostgresStorageOptions) => {
  const core = await openPgCore(options);
  const bind = async (supplied: ScopeGrant<unknown>): Promise<PgScoped> => {
    const grant = ownPgValue(supplied);
    await core.tx.run(true, (session) => core.check(session, grant, Array.isArray(grant.operations) ? grant.operations[0]! : 'read'));
    return new PgScoped(core, grant);
  };
  const adapter = Object.freeze({ moduleId: options.moduleId, incarnation: core.incarnation, bind });
  return Object.freeze({ ...adapter,
    bindNew: async (supplied: ScopeGrant<unknown>): Promise<PgScoped> => { const grant = ownPgValue(supplied); await core.issue(grant); return new PgScoped(core, grant); },
    revoke: (token: string) => core.revoke(token),
    recoverStaged: (operator: ScopeGrant<unknown>, input: PgRecoveryRequest) => recoverPgStaged(core, ownPgValue(operator), input),
    provisionFence: (grant: ScopeGrant<unknown>, fence: WriterFence, leaseUntil?: string) => core.provision(ownPgValue(grant), ownPgValue(fence), leaseUntil),
    adapter: () => adapter,
  });
};
export type { PostgresStorageOptions, InjectedPgDriver, PgSession, PgTransactionOptions, SqlStatement, SqlResult, SqlValue, PgLayout, PgOutboxBinding, PgRegisteredQuery } from './protocol.js';
export { PostgresStorageError, classifyPgFailure } from './errors.js';
export { loadPgAssets, applyPgMigrations, verifyPgInstallation } from './migrations.js';
export type { PgAsset, PgHostHistory, PgMigrationReceipt } from './migrations.js';
export type { PgScoped } from './scope.js';
