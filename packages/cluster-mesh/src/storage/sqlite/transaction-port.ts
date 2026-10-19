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
  const port = new Proxy(tx, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        verify();
        const result = await value.apply(target, args);
        verify();
        return result;
      };
    },
  });
  try {
    verify();
    const result = await callback(port);
    verify();
    return result;
  } finally { active = false; }
};
