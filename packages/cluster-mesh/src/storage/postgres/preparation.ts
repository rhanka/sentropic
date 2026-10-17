import type { ScopeGrant } from '../authority.js';
import type { WorkLimits } from '../contracts.js';
import type { AtomicUnit } from '../atomic.js';
import { StorageCapacityExceededError, StorageInvalidCommandError } from '../errors.js';
import { EFFECT_SECTIONS, emptyEffects } from '../staged-preparation.js';
import type { PgCore } from './core.js';
import type { PgSession } from './protocol.js';
import type { PgUnit } from './units.js';
import { readPgFragmentMetadata } from './staged.js';
import { decodePgBytes, decodePgJson, decodePgUtf8 } from './codec.js';
import { applyPgEffects } from './effects.js';
import { updatePortableDigest, finishPortableDigest } from './digest.js';
import { pgJsonBytes } from './roots.js';
import { pgUnitDigest } from './ordinary-transactions.js';
import { checkPgStagedModule } from './staged-module.js';
export interface PgStepWork {
  items: number;
  appends: number;
  bytes: number;
}
export const preparePgStep = async (
  core: PgCore,
  session: PgSession,
  grant: ScopeGrant<unknown>,
  unit: PgUnit,
  limits: WorkLimits,
): Promise<PgStepWork> => {
  const p = unit.metadata.progress!;
  const work = { items: 0, appends: 0, bytes: 0 };
  while (work.items < limits.maxRecords && work.bytes < limits.maxEncodedBytes && p.fragment < unit.metadata.count) {
    const metadata = await readPgFragmentMetadata(core, session, unit, p.fragment);
    if (p.phase === 0) {
      while (p.section < 9 && p.item >= metadata.counts[p.section]!) {
        p.section += 1;
        p.item = 0;
      }
      if (p.section === 9) {
        p.phase = 1;
        p.offset = 0;
        continue;
      }
      if (p.section === 2 && work.appends >= limits.maxAppends) break;
      const result = await session.execute({
        text: `SELECT cost, CASE WHEN cost<=$5 THEN bytes ELSE NULL END AS bytes
        FROM ${core.roots.schema}.staged_items WHERE unit_id=$1 AND ordinal=$2::bigint AND
        section=$3 AND item=$4`,
        values: [unit.id, String(p.fragment), p.section, p.item, limits.maxEncodedBytes],
      });
      const row = result.rows[0];
      const cost = Number(row?.cost);
      if (!Number.isSafeInteger(cost) || cost <= 0 || row?.bytes === null)
        throw new StorageCapacityExceededError('an indivisible seal item requires a larger declared budget');
      if (cost + work.bytes > limits.maxEncodedBytes) break;
      const value = decodePgJson(decodePgUtf8(row!.bytes));
      if (p.section === 8)
        unit.metadata.moduleResultPayload = await core.roots.payload(
          session,
          grant.scope,
          `$unit-result:${unit.id}`,
          pgJsonBytes(value),
          pgUnitDigest(value),
        );
      else {
        const section = EFFECT_SECTIONS[p.section]!;
        const effects = { ...emptyEffects(), [section]: [value] } as AtomicUnit;
        if (
          section === 'appends' &&
          effects.appends[0]!.expectation.kind === 'head' &&
          !(await core.roots.get(session, p.prepared, 'chain', effects.appends[0]!.chainId))
        )
          throw new StorageInvalidCommandError('staged append dependency unresolved');
        const next = await applyPgEffects(core, session, grant, p.prepared, effects, p.base.root);
        p.prepared = next.root;
        p.records += next.records;
        p.appends += next.appends;
        work.appends += next.appends;
      }
      p.item += 1;
      p.checked += 1;
      work.items += 1;
      work.bytes += cost;
      continue;
    }
    const dependency = p.phase === 1;
    const key = dependency ? 'dependency' : 'effect';
    const length = dependency ? metadata.dependencyLength : metadata.effectLength;
    if (p.offset === 0 && p.fragment > 0) {
      p[key] = updatePortableDigest(p[key], Buffer.from(','));
      p.offset = -1;
      work.bytes += 1;
      if (work.bytes >= limits.maxEncodedBytes) break;
    }
    const start = Math.max(p.offset, 0);
    const count = Math.min(length - start, limits.maxEncodedBytes - work.bytes);
    const column = dependency ? 'dependency_part' : 'effect_part';
    const chunk = await session.execute({
      text: `SELECT substring(${column} FROM $3::integer FOR $4::integer) AS bytes FROM ${core.roots.schema}.fragments WHERE unit_id=$1 AND ordinal=$2::bigint`,
      values: [unit.id, String(p.fragment), start + 1, count],
    });
    const bytes = decodePgBytes(chunk.rows[0]?.bytes);
    if (bytes.length !== count) throw new StorageInvalidCommandError('incomplete persisted commitment');
    p[key] = updatePortableDigest(p[key], bytes);
    p.offset = start + count;
    work.bytes += count;
    work.items += 1;
    if (p.offset === length) {
      p.offset = 0;
      p.phase += 1;
      if (p.phase === 3) {
        p.fragment += 1;
        p.section = 0;
        p.item = 0;
        p.phase = 0;
        p.checked += 1;
      }
    }
  }
  if (p.fragment === unit.metadata.count) {
    // The two fixed suffixes are chunked too, including one-byte budgets.
    if (p.phase === 0) {
      p.phase = 3;
      p.offset = 0;
    }
    while (p.phase < 5 && work.items < limits.maxRecords && work.bytes < limits.maxEncodedBytes) {
      const count = Math.min(2 - p.offset, limits.maxEncodedBytes - work.bytes);
      const key = p.phase === 3 ? 'dependency' : 'effect';
      p[key] = updatePortableDigest(p[key], Buffer.from(']]').subarray(p.offset, p.offset + count));
      p.offset += count;
      work.bytes += count;
      work.items += 1;
      if (p.offset === 2) {
        p.phase += 1;
        p.offset = 0;
      }
    }
    if (p.phase === 5) {
      if (
        finishPortableDigest(p.dependency) !== p.root.dependencyRoot ||
        finishPortableDigest(p.effect) !== p.root.effectRoot
      )
        throw new StorageInvalidCommandError('staged commitment mismatch');
      await checkPgStagedModule(core, session, grant, unit, 'seal', p.root, undefined, true);
      p.prepared = await core.roots.put(session, p.prepared, 'unit-root', unit.metadata.begin.operationKey, p.root);
      unit.metadata.seal = { unitId: unit.id, commitRoot: p.root, capability: core.id('seal-capability') };
      unit.metadata.state = 'sealed';
    }
  }
  return work;
};
