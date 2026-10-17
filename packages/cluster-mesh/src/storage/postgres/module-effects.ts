import type { AtomicUnit } from '../atomic.js';
import type { ScopeGrant } from '../authority.js';
import { StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import { linkPgCoverage } from './coverage.js';
export const validatePgPurgePolicy = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  root: string | null,
  barriers: number,
  purges: number,
): Promise<void> => {
  const policy = (await core.roots.get<string>(session, root, 'policy', 'purge')) ?? 'unconfigured';
  if (purges > 0) {
    await core.check(session, grant, 'maintain');
    if (policy === 'unconfigured') throw new StorageDeniedError('purge policy is not configured');
  }
  if (policy === 'required' && barriers > 0 && purges === 0)
    throw new StorageInvalidCommandError('purge intent required with barrier');
};
export const applyPgModuleEffects = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  initial: string | null,
  unit: AtomicUnit,
  installed = false,
  coverageRoot = initial,
): Promise<string | null> => {
  const store = core.roots;
  let root = initial;
  for (const change of unit.relationships) {
    if (change.relation === 'coverage-parent-v1') {
      if (change.kind !== 'add') throw new StorageInvalidCommandError('coverage removal is not supported');
      root = await linkPgCoverage(core, session, root, change.from, change.to, installed, coverageRoot);
    }
    const id = JSON.stringify([change.relation, change.from]);
    const relation = (await store.get<{ root: string | null; count: number }>(session, root, 'relation', id)) ?? {
      root: null,
      count: 0,
    };
    const previous = await store.get<boolean>(session, relation.root, 'target', change.to);
    if (change.kind === 'remove' && !previous) throw new StorageInvalidCommandError('relationship target missing');
    const targets = await store.put(session, relation.root, 'target', change.to, change.kind === 'add' ? true : null);
    root = await store.put(session, root, 'relation', id, {
      root: targets,
      count: relation.count + (change.kind === 'remove' ? -1 : previous ? 0 : 1),
    });
  }
  for (const barrier of unit.barriers)
    root = await store.put(session, root, 'barrier', barrier.boundary, {
      reason: barrier.reason,
      createdAt: core.now(),
    });
  for (const intent of unit.purgeIntents) {
    await core.check(session, grant, 'maintain');
    if (intent.authorizedBy !== grant.principalId) throw new StorageDeniedError('unverified purge authorizer');
    const previous = await store.get<{ target: string; authorizedBy: string }>(
      session,
      root,
      'purge-job',
      intent.intentId,
    );
    if (previous && (previous.target !== intent.target || previous.authorizedBy !== intent.authorizedBy))
      throw new StorageIdempotencyConflictError('purge identity conflict');
    if (!previous)
      root = await store.put(session, root, 'purge-job', intent.intentId, {
        ...intent,
        state: 'pending',
        outcomeId: null,
        payloadDisposition: null,
        position: null,
      });
  }
  return root;
};
