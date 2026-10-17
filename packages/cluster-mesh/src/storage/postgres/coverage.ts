import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
export const linkPgCoverage = async (
  core: PgCore,
  session: PgSession,
  root: string | null,
  parent: string,
  child: string,
  installed = false,
  coverageRoot = root,
): Promise<string> => {
  const parents = (await core.roots.get<readonly string[]>(session, root, 'parents', child)) ?? [];
  if (parents.length && (parents.length !== 1 || parents[0] !== parent))
    throw new StorageInvalidCommandError('coverage parent is immutable');
  try {
    if (!installed) {
      await core.visible(session, coverageRoot, parent);
      await core.visible(session, coverageRoot, child);
    }
  } catch (error) {
    if (error instanceof StorageDeniedError) throw new StorageInvalidCommandError('covered relationship refused');
    throw error;
  }
  const pending = [parent];
  const seen = new Set<string>([child]);
  while (pending.length) {
    const next = pending.pop()!;
    if (seen.has(next) || seen.size >= 128) throw new StorageInvalidCommandError('coverage cycle or depth exceeded');
    seen.add(next);
    pending.push(...((await core.roots.get<readonly string[]>(session, root, 'parents', next)) ?? []));
  }
  return core.roots.put(session, root, 'parents', child, [parent]);
};
