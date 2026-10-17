import type { ScopeGrant } from '../authority.js';
import type { WriterFence } from '../contracts.js';
import { StorageCasConflictError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import type { PgUnit } from './units.js';
import { pgUnitHandle } from './units.js';
import { ownPgValue } from './ordinary-transactions.js';
import { decodePgJson, decodePgText } from './codec.js';
export interface PgRecoveryRequest { readonly operationKey: string; readonly expectedOwner: string; readonly recipient: ScopeGrant<unknown>; readonly fence: WriterFence; readonly reason: string; }
export const recoverPgStaged = async (core: PgCore, operator: ScopeGrant<unknown>, supplied: PgRecoveryRequest) => {
  const input = ownPgValue(supplied);
  if (!input.reason || input.reason.length > 4096 || core.roots.key(operator.scope) !== core.roots.key(input.recipient.scope)) throw new StorageInvalidCommandError('owner recovery requires a bounded reason and equal full scope');
  return core.tx.run(false, async (session) => {
    await core.check(session, operator, 'maintain', true); await core.check(session, input.recipient, 'write', true); await core.fence(session, input.recipient, input.fence);
    const result = await session.execute({ text: `SELECT id,owner,metadata::text FROM ${core.roots.schema}.units WHERE scope_key=$1 AND operation=$2 FOR UPDATE`, values: [core.roots.key(operator.scope), input.operationKey] });
    const row = result.rows[0];
    if (!row) throw new StorageInvalidCommandError('unknown operation for recovery');
    if (row.owner !== input.expectedOwner) throw new StorageCasConflictError('staged owner changed before recovery');
    const metadata = decodePgJson<PgUnit['metadata']>(decodePgText(row.metadata));
    if (metadata.version !== 'pg-staged-v1' || metadata.incarnation !== core.incarnation || !['staging', 'sealing', 'sealed'].includes(metadata.state) || input.fence.fenceId !== metadata.fence.fenceId || BigInt(input.fence.epoch) <= BigInt(metadata.fence.epoch)) throw new StorageInvalidCommandError('recovery requires an active operation and advanced owner epoch');
    const unit: PgUnit = { id: decodePgText(row.id), owner: input.recipient.principalId, capability: core.id('unit-capability'), metadata };
    metadata.fence = input.fence;
    if (metadata.seal) metadata.seal = { ...metadata.seal, capability: core.id('seal-capability') };
    await session.execute({ text: `UPDATE ${core.roots.schema}.units SET owner=$1,capability=$2,metadata=$3::jsonb WHERE scope_key=$4 AND id=$5 AND owner=$6`, values: [unit.owner, unit.capability, JSON.stringify(metadata), core.roots.key(operator.scope), unit.id, input.expectedOwner] });
    await session.execute({ text: `INSERT INTO ${core.roots.schema}.consumer_actions(scope_key,consumer,operation,owner,event_id) VALUES($1,$2,'recover-staged',$3,$4)`, values: [core.roots.key(operator.scope), `$unit:${unit.id}`, operator.principalId, JSON.stringify({ previousOwner: input.expectedOwner, owner: unit.owner, fence: input.fence, reason: input.reason })] });
    return { unit: pgUnitHandle(core, input.recipient, unit), ...(metadata.seal ? { seal: ownPgValue(metadata.seal) } : {}) };
  });
};
