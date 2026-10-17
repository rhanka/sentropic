import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import { decodePgText } from './codec.js';
import type { AtomicUnit } from '../atomic.js';
interface HiddenCoverage { readonly scopeKey: string; readonly unitId: string; }
export const visitPgCoverage = async (core: PgCore, session: PgSession, root: string | null, target: string, match: (id: string) => Promise<boolean>, hidden?: HiddenCoverage, seen = new Set<string>()): Promise<boolean> => {
  if (seen.has(target)) return false;
  if (seen.size >= 128) throw new StorageInvalidCommandError('coverage path exceeds registered depth');
  seen.add(target); if (await match(target)) return true;
  const parents = new Set(await core.roots.get<readonly string[]>(session, root, 'parents', target) ?? []);
  if (hidden) {
    const rows = await session.execute({ text: `SELECT parent FROM ${core.roots.schema}.staged_coverage WHERE scope_key=$1 AND unit_id=$2 AND child=$3`, values: [hidden.scopeKey, hidden.unitId, target] });
    for (const row of rows.rows) parents.add(decodePgText(row.parent));
  }
  for (const parent of parents) if (await visitPgCoverage(core, session, root, parent, match, hidden, seen)) return true;
  return false;
};
export const assertPgHiddenVisible = async (core: PgCore, session: PgSession, root: string | null, target: string, hidden: HiddenCoverage): Promise<void> => {
  if (await visitPgCoverage(core, session, root, target, async (id) => Boolean(await core.roots.get(session, root, 'barrier', id) || await core.roots.get(session, root, 'disposed', id)), hidden)) throw new StorageDeniedError('hidden target is covered');
};
export const registerPgHiddenCoverage = async (core: PgCore, session: PgSession, hidden: HiddenCoverage, effects: AtomicUnit): Promise<void> => {
  for (const change of effects.relationships) if (change.relation === 'coverage-parent-v1') {
    if (change.kind !== 'add') throw new StorageInvalidCommandError('hidden coverage removal is not supported');
    const result = await session.execute({ text: `INSERT INTO ${core.roots.schema}.staged_coverage AS c(scope_key,unit_id,child,parent) VALUES($1,$2,$3,$4) ON CONFLICT(scope_key,unit_id,child) DO UPDATE SET parent=EXCLUDED.parent WHERE c.parent=EXCLUDED.parent RETURNING child`, values: [hidden.scopeKey, hidden.unitId, change.to, change.from] });
    if (result.rows.length !== 1) throw new StorageInvalidCommandError('hidden coverage parent is immutable');
  }
};
