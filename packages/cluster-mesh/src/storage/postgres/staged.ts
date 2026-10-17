import type { ScopeGrant } from '../authority.js';
import { StorageDeniedError, StorageIdempotencyConflictError, StorageInvalidCommandError } from '../errors.js';
import { validateBeginInput, validateFragmentInput, type StagedBeginInput, type FragmentReceipt, type StagedUnitStatus } from '../staged-units.js';
import { deriveStagedDependencies, stagedEffectDigest, stagedFragmentDigest } from '../staged-codec.js';
import { EFFECT_SECTIONS } from '../staged-preparation.js';
import type { RootStageInput } from '../staged-operations.js';
import type { AuthenticatedStagedHandle } from '../staged-state.js';
import type { PgCore } from './core.js';
import { ownPgValue } from './ordinary-transactions.js';
import { pgJsonBytes } from './roots.js';
import { decodePgJson, decodePgText } from './codec.js';
import { pgUnitHandle, readPgUnit, resolvePgUnit, savePgUnit, type PgUnit } from './units.js';
export const beginPgStaged = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: StagedBeginInput): Promise<AuthenticatedStagedHandle> => {
  const input = ownPgValue(supplied);
  if (!validateBeginInput(input).ok || pgJsonBytes(input).length > core.work().maxEncodedBytes) throw new StorageInvalidCommandError('invalid staged begin');
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'write', true); await core.fence(session, grant, input.fence);
    const id = core.id('unit');
    const metadata: PgUnit['metadata'] = { version: 'pg-staged-v1', incarnation: core.incarnation, begin: input, fence: input.fence, state: 'staging', count: 0, frontier: null,
      barriers: 0, purges: 0, commitId: core.id('staged-commit'), progress: null, seal: null, receipt: null };
    await session.execute({ text: `INSERT INTO ${core.roots.schema}.units(scope_key,operation,id,owner,capability,metadata) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(scope_key,operation) DO NOTHING`, values: [core.roots.key(grant.scope), input.operationKey, id, grant.principalId, core.id('unit-capability'), JSON.stringify(metadata)] });
    const found = await session.execute({ text: `SELECT id FROM ${core.roots.schema}.units WHERE scope_key=$1 AND operation=$2`, values: [core.roots.key(grant.scope), input.operationKey] });
    const unit = await readPgUnit(core, session, grant, decodePgText(found.rows[0]?.id));
    const before = unit.metadata.begin;
    if (before.inputDigest !== input.inputDigest || before.contractDigest !== input.contractDigest || before.sourceBoundary !== input.sourceBoundary) throw new StorageIdempotencyConflictError('divergent staged begin');
    if (unit.metadata.fence.fenceId !== input.fence.fenceId || unit.metadata.fence.epoch !== input.fence.epoch) throw new StorageInvalidCommandError('operation requires explicit owner recovery');
    return pgUnitHandle(core, grant, unit);
  }, true);
};
export const stagePgFragment = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: RootStageInput): Promise<FragmentReceipt> => {
  const input = ownPgValue(supplied); const effects = input.effects; const limits = core.work(input.limits);
  if (!validateFragmentInput({ ...input, unitId: input.unit.unitId }, limits).ok || pgJsonBytes(effects).length > limits.maxEncodedBytes || EFFECT_SECTIONS.reduce((n, key) => n + effects[key].length, effects.moduleResult === undefined ? 0 : 1) > limits.maxRecords) throw new StorageInvalidCommandError('invalid staged fragment or admission limits');
  return core.tx.run(false, async (session) => {
    const unit = await resolvePgUnit(core, session, grant, input.unit, input.fence);
    const metadata = unit.metadata;
    if (effects.purgeIntents.length) {
      await core.check(session, grant, 'maintain');
      if (effects.purgeIntents.some((intent) => intent.authorizedBy !== grant.principalId)) throw new StorageDeniedError('unverified purge authorizer');
    }
    const digest = stagedFragmentDigest({ moduleId: core.options.moduleId, scope: grant.scope, operationId: metadata.begin.operationKey, contractDigest: metadata.begin.contractDigest, sourceBoundary: metadata.begin.sourceBoundary, ordinal: input.ordinal, predecessorHash: input.predecessorHash }, effects);
    const prior = await session.execute({ text: `SELECT digest FROM ${core.roots.schema}.fragments WHERE unit_id=$1 AND ordinal=$2::bigint`, values: [unit.id, input.ordinal] });
    if (prior.rows[0] && metadata.state !== 'aborted') {
      if (prior.rows[0].digest !== digest || input.fragmentDigest !== digest) throw new StorageIdempotencyConflictError('changed accepted fragment');
      return { unitId: unit.id, ordinal: input.ordinal, fragmentDigest: digest };
    }
    if (metadata.state !== 'staging' || input.ordinal !== String(metadata.count) || input.predecessorHash !== metadata.frontier || input.fragmentDigest !== digest) throw new StorageInvalidCommandError('fragment frontier or state mismatch');
    const current = await core.roots.capture(session, grant.scope);
    for (const target of [...effects.records.map((item) => item.key), ...effects.appends.map((item) => item.chainId), ...effects.updates.map((item) => item.key), ...effects.indexWrites.map((item) => item.key)]) {
      try { await core.visible(session, current.root, target); }
      catch (error) { if (error instanceof StorageDeniedError) throw new StorageInvalidCommandError('covered staged intake refused'); throw error; }
    }
    const dependency = pgJsonBytes([input.ordinal, deriveStagedDependencies(effects)]); const effect = pgJsonBytes([input.ordinal, stagedEffectDigest(effects)]);
    const counts = [...EFFECT_SECTIONS.map((key) => effects[key].length), effects.moduleResult === undefined ? 0 : 1];
    await session.execute({ text: `INSERT INTO ${core.roots.schema}.fragments(unit_id,ordinal,digest,predecessor,effects,metadata,dependency_part,effect_part) VALUES($1,$2::bigint,$3,$4,NULL,$5::jsonb,$6,$7)`, values: [unit.id, input.ordinal, digest, input.predecessorHash, JSON.stringify({ counts, dependencyLength: dependency.length, effectLength: effect.length }), dependency, effect] });
    const sections: readonly (readonly unknown[])[] = [...EFFECT_SECTIONS.map((key) => effects[key]), effects.moduleResult === undefined ? [] : [effects.moduleResult]];
    for (const [section, values] of sections.entries()) for (const [item, value] of values.entries()) {
      const bytes = pgJsonBytes(value); const fields = value as Record<string, unknown>;
      const target = typeof fields.chainId === 'string' ? fields.chainId : typeof fields.key === 'string' ? fields.key : null;
      await session.execute({ text: `INSERT INTO ${core.roots.schema}.staged_items(scope_key,target,unit_id,ordinal,section,item,bytes,cost) VALUES($1,$2,$3,$4::bigint,$5,$6,$7,$8)`, values: [core.roots.key(grant.scope), target, unit.id, input.ordinal, section, item, bytes, bytes.length] });
    }
    metadata.count += 1; metadata.frontier = digest; metadata.barriers += effects.barriers.length; metadata.purges += effects.purgeIntents.length;
    await core.fence(session, grant, input.fence); await savePgUnit(core, session, grant, unit);
    return { unitId: unit.id, ordinal: input.ordinal, fragmentDigest: digest };
  }, true);
};
export const readPgFragmentMetadata = async (core: PgCore, session: import('./protocol.js').PgSession, unit: PgUnit, ordinal: number) => {
  const result = await session.execute({ text: `SELECT metadata::text FROM ${core.roots.schema}.fragments WHERE unit_id=$1 AND ordinal=$2::bigint`, values: [unit.id, String(ordinal)] });
  return decodePgJson<{ counts: number[]; dependencyLength: number; effectLength: number }>(decodePgText(result.rows[0]?.metadata));
};
export const inspectPgStaged = async (core: PgCore, grant: ScopeGrant<unknown>, operationKey: string): Promise<StagedUnitStatus> => core.tx.run(false, async (session) => {
  await core.check(session, grant, 'write');
  const result = await session.execute({ text: `SELECT id FROM ${core.roots.schema}.units WHERE scope_key=$1 AND operation=$2`, values: [core.roots.key(grant.scope), operationKey] });
  if (!result.rows[0]) throw new StorageInvalidCommandError('unknown staged operation');
  const unit = await readPgUnit(core, session, grant, decodePgText(result.rows[0].id)); const m = unit.metadata;
  if (m.state === 'staging' || m.state === 'sealing') return { state: m.state, acceptedFragments: String(m.count) };
  if (m.state === 'sealed') return { state: 'sealed', seal: ownPgValue(m.seal!) };
  if (m.state === 'committed') return { state: 'committed', commitId: m.receipt!.commitId };
  return { state: 'aborted', reason: m.reason! };
});
