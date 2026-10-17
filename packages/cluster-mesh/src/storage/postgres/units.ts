import type { ScopeGrant } from '../authority.js';
import type { AtomicUnit, CommitReceipt } from '../atomic.js';
import type { WriterFence } from '../contracts.js';
import { StorageDeniedError, StorageInvalidCommandError } from '../errors.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../staged-state.js';
import type { StagedBeginInput, StagedCommitRoot, StagedState } from '../staged-units.js';
import { decodePgJson, decodePgText } from './codec.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import type { PgRoot } from './roots.js';
import type { PortableDigestState } from './digest.js';
import { PostgresStorageError } from './errors.js';
export interface PgSealProgress {
  base: PgRoot; prepared: string | null; root: StagedCommitRoot;
  fragment: number; section: number; item: number; phase: number; offset: number;
  dependency: PortableDigestState; effect: PortableDigestState; checked: number;
  records: number; appends: number;
}
export interface PgUnit {
  readonly id: string; readonly owner: string; readonly capability: string;
  metadata: {
    version: 'pg-staged-v1'; incarnation: string; begin: StagedBeginInput; fence: WriterFence;
    state: StagedState; count: number; frontier: string | null; barriers: number; purges: number;
    commitId: string; progress: PgSealProgress | null; seal: AuthenticatedStagedSeal | null;
    receipt: CommitReceipt | null; moduleResultPayload?: string; reason?: string;
    cleanup?: { phase: 'items' | 'payloads' | 'coverage'; complete: boolean };
  };
}
export const readPgUnit = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, unitId: string): Promise<PgUnit> => {
  const result = await session.execute({ text: `SELECT id,owner,capability,metadata::text FROM ${core.roots.schema}.units WHERE scope_key=$1 AND id=$2 FOR UPDATE`, values: [core.roots.key(grant.scope), unitId] });
  const row = result.rows[0];
  if (!row) throw new StorageInvalidCommandError('unknown staged unit');
  const metadata = decodePgJson<PgUnit['metadata']>(decodePgText(row.metadata));
  if (metadata.version !== 'pg-staged-v1' || metadata.incarnation !== core.incarnation || !Number.isSafeInteger(metadata.count) || metadata.count < 0) throw new PostgresStorageError('corruption');
  if (row.owner !== grant.principalId) throw new StorageDeniedError('staged unit belongs to another principal');
  return { id: decodePgText(row.id), owner: decodePgText(row.owner), capability: decodePgText(row.capability), metadata };
};
export const savePgUnit = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, unit: PgUnit): Promise<void> => {
  await session.execute({ text: `UPDATE ${core.roots.schema}.units SET metadata=$1::jsonb WHERE scope_key=$2 AND id=$3`, values: [JSON.stringify(unit.metadata), core.roots.key(grant.scope), unit.id] });
};
export const pgUnitHandle = (core: PgCore, grant: ScopeGrant<unknown>, unit: PgUnit): AuthenticatedStagedHandle => ({
  unitId: unit.id, operationKey: unit.metadata.begin.operationKey, moduleId: core.options.moduleId,
  scope: { ...grant.scope }, state: unit.metadata.state, capability: unit.capability,
});
export const resolvePgUnit = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, handle: AuthenticatedStagedHandle, fence: WriterFence): Promise<PgUnit> => {
  await core.check(session, grant, 'write', true);
  await core.fence(session, grant, fence);
  if (!handle || handle.moduleId !== core.options.moduleId || handle.scope?.tenantId !== grant.scope.tenantId || handle.scope.workspaceId !== grant.scope.workspaceId) throw new StorageInvalidCommandError('staged scope binding mismatch');
  const unit = await readPgUnit(core, session, grant, handle.unitId);
  if (unit.capability !== handle.capability || unit.metadata.begin.operationKey !== handle.operationKey || unit.metadata.fence.fenceId !== fence.fenceId || unit.metadata.fence.epoch !== fence.epoch) throw new StorageInvalidCommandError('staged capability or owner epoch mismatch');
  return unit;
};
