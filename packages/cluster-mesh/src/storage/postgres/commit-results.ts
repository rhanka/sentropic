import type { ScopeGrant } from '../authority.js';
import type { CommitReceipt } from '../atomic.js';
import { isNonEmptyString, validateEncodedValue, type EncodedValue, type WriterFence } from '../contracts.js';
import { StorageInvalidCommandError, StorageUnavailableError } from '../errors.js';
import type { PgCore } from './core.js';
import { PostgresStorageError } from './errors.js';
import { ownPgValue } from './ordinary-transactions.js';

/** Read the committed root only; never synthesize a module result or replay effects. */
export const readPgCommitResult = async (
  core: PgCore,
  grant: ScopeGrant<unknown>,
  commitIdentity: string,
  suppliedFence: WriterFence,
): Promise<EncodedValue | null> => {
  if (!isNonEmptyString(commitIdentity)) throw new StorageInvalidCommandError('commit identity must be non-empty');
  const { fence } = ownPgValue({ fence: suppliedFence });
  // FOR SHARE keeps grant revocation and fence takeover serialized through
  // completion. Such row locks require a read-write PostgreSQL transaction.
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'read', true);
    await core.fence(session, grant, fence);
    const base = await core.roots.capture(session, grant.scope);
    const stored = await core.roots.get<{ receipt: CommitReceipt }>(session, base.root, 'commit', commitIdentity);
    await core.check(session, grant, 'read', true);
    await core.fence(session, grant, fence);
    if (stored === null) return null;
    if (stored.receipt.moduleResult === undefined)
      throw new StorageUnavailableError('commit has no stored original module result');
    if (!validateEncodedValue(stored.receipt.moduleResult).ok) throw new PostgresStorageError('corruption');
    return ownPgValue(stored.receipt.moduleResult);
  });
};
