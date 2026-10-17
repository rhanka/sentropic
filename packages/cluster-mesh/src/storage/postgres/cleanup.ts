import type { ScopeGrant } from '../authority.js';
import type { WorkLimits, WriterFence } from '../contracts.js';
import { StorageCapacityExceededError, StorageInvalidCommandError } from '../errors.js';
import type { PgCore } from './core.js';
import { decodePgCounter, decodePgText } from './codec.js';
import { ownPgValue } from './ordinary-transactions.js';
import { readPgUnit, savePgUnit } from './units.js';
export interface PgCleanupRequest {
  readonly operationKey: string;
  readonly fence: WriterFence;
  readonly limits: WorkLimits;
}
export const cleanupPgStaged = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: PgCleanupRequest) => {
  const input = ownPgValue(supplied);
  const limits = core.work(input.limits);
  if (typeof input.operationKey !== 'string' || !input.operationKey || input.operationKey.length > 4096)
    throw new StorageInvalidCommandError('invalid cleanup identity');
  return core.tx.run(
    false,
    async (session) => {
      await core.check(session, grant, 'maintain', true);
      await core.fence(session, grant, input.fence);
      const found = await session.execute({
        text: `SELECT id FROM ${core.roots.schema}.units WHERE scope_key=$1 AND operation=$2`,
        values: [core.roots.key(grant.scope), input.operationKey],
      });
      const unit = await readPgUnit(core, session, grant, decodePgText(found.rows[0]?.id));
      const m = unit.metadata;
      if (m.state !== 'aborted' && m.state !== 'committed')
        throw new StorageInvalidCommandError('cleanup requires a terminal operation');
      const progress = m.cleanup ?? { phase: 'items' as const, complete: false };
      const work = { items: 0, bytes: 0 };
      while (!progress.complete && work.items < limits.maxRecords) {
        const items = progress.phase === 'items';
        const coverage = progress.phase === 'coverage';
        const table = items ? 'staged_items' : coverage ? 'staged_coverage' : 'payloads';
        const owner = items || coverage ? 'unit_id' : 'prepared_unit';
        const identity = coverage ? 'child' : 'id';
        const result = await session.execute({
          text: `SELECT candidate.${identity}::text AS id,
        ${coverage ? '0' : 'coalesce(octet_length(candidate.bytes),0)'} AS cost
        FROM ${core.roots.schema}.${table} AS candidate
        WHERE candidate.${owner}=$1 AND candidate.scope_key=$2 ORDER BY
        candidate.${identity} LIMIT 1`,
          values: [unit.id, core.roots.key(grant.scope)],
        });
        if (!result.rows[0]) {
          if (items && m.state === 'aborted') {
            progress.phase = 'payloads';
            continue;
          }
          if (!coverage) {
            progress.phase = 'coverage';
            continue;
          }
          progress.complete = true;
          break;
        }
        const row = result.rows[0];
        const cost = Number(row.cost);
        if (!Number.isSafeInteger(cost) || cost < 0 || cost > limits.maxEncodedBytes)
          throw new StorageCapacityExceededError('cleanup item exceeds requested work budget');
        if (cost + work.bytes > limits.maxEncodedBytes) break;
        const id = items ? decodePgCounter(row.id) : decodePgText(row.id);
        await session.execute({
          text: `DELETE FROM ${core.roots.schema}.${table} WHERE ${owner}=$1 AND scope_key=$2 AND ${identity}=$3::${items ? 'bigint' : 'text'}`,
          values: [unit.id, core.roots.key(grant.scope), id],
        });
        work.items += 1;
        work.bytes += cost;
      }
      m.cleanup = progress;
      await core.check(session, grant, 'maintain', true);
      await core.fence(session, grant, input.fence);
      await savePgUnit(core, session, grant, unit);
      return { state: m.state, complete: progress.complete, work };
    },
    true,
  );
};
