import { openPgCore } from './core.js';
import { PgScoped } from './scope.js';
import { ownPgValue } from './ordinary-transactions.js';
import type { ScopeGrant } from '../authority.js';
import type { WriterFence } from '../contracts.js';
import type { PostgresStorageOptions } from './protocol.js';
import { recoverPgStaged, type PgRecoveryRequest } from './recovery.js';
import { StorageInvalidCommandError } from '../errors.js';
export const createPostgresKernel = async (options: PostgresStorageOptions) => {
  const core = await openPgCore(options);
  const bind = async (supplied: ScopeGrant<unknown>): Promise<PgScoped> => {
    const grant = ownPgValue(supplied);
    const operation = Array.isArray(grant.operations) ? grant.operations[0]! : 'read';
    const active = core.ambient.getStore();
    if (active) {
      if (active.closed) throw new StorageInvalidCommandError('binding transaction is closed');
      await core.check(active.session, grant, operation);
      if (core.roots.key(active.scope) !== core.roots.key(grant.scope))
        throw new StorageInvalidCommandError('binding scope differs from the active transaction');
      active.revalidators.add(() => core.check(active.session, grant, operation));
    } else await core.tx.run(true, (session) => core.check(session, grant, operation));
    return new PgScoped(core, grant);
  };
  const adapter = Object.freeze({ moduleId: core.options.moduleId, incarnation: core.incarnation, bind });
  return Object.freeze({
    ...adapter,
    bindNew: async (supplied: ScopeGrant<unknown>): Promise<PgScoped> => {
      const grant = ownPgValue(supplied);
      await core.issue(grant);
      return new PgScoped(core, grant);
    },
    revoke: (token: string) => core.revoke(token),
    recoverStaged: (operator: ScopeGrant<unknown>, input: PgRecoveryRequest) =>
      recoverPgStaged(core, ownPgValue(operator), input),
    provisionFence: (grant: ScopeGrant<unknown>, fence: WriterFence, leaseUntil?: string) =>
      core.provision(ownPgValue(grant), ownPgValue(fence), leaseUntil),
    adapter: () => adapter,
  });
};
export type {
  PostgresStorageOptions,
  InjectedPgDriver,
  PgSession,
  PgTransactionOptions,
  SqlStatement,
  SqlResult,
  SqlValue,
  PgLayout,
  PgOutboxBinding,
  PgRegisteredQuery,
} from './protocol.js';
export { PostgresStorageError, PgSchemaDriftError, classifyPgFailure } from './errors.js';
export { loadPgAssets, applyPgMigrations, verifyPgInstallation, reattestPgInstallation } from './migrations.js';
export type { PgAsset, PgHostHistory, PgMigrationReceipt, PgSchemaAttestation } from './migrations.js';
export type { PgScoped } from './scope.js';
export type { PgCapability, PgProfilePorts } from './profiles.js';
