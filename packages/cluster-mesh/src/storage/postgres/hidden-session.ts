import type { ScopeGrant } from '../authority.js';
import type { WriterFence } from '../contracts.js';
import { StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
export const runPgHidden = async <T,>(
  core: PgCore,
  grant: ScopeGrant<unknown>,
  operation: (session: PgSession) => Promise<T>,
  fence?: WriterFence,
): Promise<T> => {
  const current = core.ambient.getStore();
  if (!current) return core.tx.run(false, operation, true);
  if (current.closed || core.roots.key(current.scope) !== core.roots.key(grant.scope))
    throw new StorageInvalidCommandError('hidden operation transaction differs or is closed');
  current.contributors.set(grant.token, grant);
  try {
    const result = await operation(current.session);
    if (fence) current.revalidators.add(() => core.fence(current.session, grant, fence));
    return result;
  } catch (error) {
    current.failed = error;
    throw error;
  }
};
