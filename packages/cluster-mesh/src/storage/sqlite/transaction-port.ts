import type { KernelTransaction } from '../scope-runtime.js';
import { CanonicalOwnershipError } from '../instance-ownership.js';
import type { SqliteEngine } from './engine.js';

/** The callback owns this port only until it returns. Results are released
 * after revalidation, including reads prepared before ownership loss. */
export const withSqliteTransaction = async <T>(engine: SqliteEngine, tx: KernelTransaction,
  callback: (port: KernelTransaction) => Promise<T>): Promise<T> => {
  let active = true;
  const verify = (): void => {
    if (!active) throw new CanonicalOwnershipError('terminal-loss', 'SQLite transaction callback has ended');
    engine.assertOwnership();
  };
  const port = Object.freeze(Object.fromEntries(
    Object.entries(tx).map(([property, value]) => [property, async (...args: unknown[]) => {
        verify();
        const result = await value.apply(tx, args);
        verify();
        return result;
    }]),
  )) as unknown as KernelTransaction;
  try {
    verify();
    const result = await callback(port);
    verify();
    return result;
  } finally { active = false; }
};
