import type { ScopeGrant } from '../authority.js';
import type { CommitReceipt } from '../atomic.js';
import type { EncodedValue, WorkLimits, WriterFence } from '../contracts.js';
import type { AuthenticatedStagedHandle, AuthenticatedStagedSeal } from '../staged-state.js';
import { encodeStagedCommitRoot } from '../staged-codec.js';
import { validateCommitRoot, type StagedCommitRoot } from '../staged-units.js';
import { StorageCasConflictError, StorageInvalidCommandError, isStorageError } from '../errors.js';
import type { PgCore } from './core.js';
import { ownPgValue } from './ordinary-transactions.js';
import { startPortableDigest, updatePortableDigest } from './digest.js';
import { readPgUnit, resolvePgUnit, savePgUnit, type PgUnit } from './units.js';
import { preparePgStep, type PgStepWork } from './preparation.js';
import { checkPgStagedModule } from './staged-module.js';
import type { PgSession } from './protocol.js';
import { decodePgJson, decodePgUtf8 } from './codec.js';
export interface PgSealRequest { readonly unit: AuthenticatedStagedHandle; readonly root: StagedCommitRoot; readonly fence: WriterFence; readonly limits: WorkLimits; }
export interface PgSealResult { readonly state: string; readonly checked: number; readonly work: PgStepWork; readonly seal?: AuthenticatedStagedSeal; }
export const sealPgStep = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: PgSealRequest): Promise<PgSealResult> => {
  const input = ownPgValue(supplied); const limits = core.work(input.limits);
  if (!validateCommitRoot(input.root).ok) throw new StorageInvalidCommandError('invalid staged root');
  await core.tx.run(false, async (session) => {
    const unit = await resolvePgUnit(core, session, grant, input.unit, input.fence); const m = unit.metadata;
    await checkPgStagedModule(core, session, grant, unit, 'seal', input.root);
    if (m.state === 'aborted') throw new StorageInvalidCommandError('staged unit is aborted');
    if (m.state !== 'staging') {
      if (encodeStagedCommitRoot(m.seal?.commitRoot ?? m.progress!.root) !== encodeStagedCommitRoot(input.root)) throw new StorageInvalidCommandError('seal intent is frozen');
      return;
    }
    if (input.root.operationId !== m.begin.operationKey || input.root.contractDigest !== m.begin.contractDigest || input.root.sourceBoundary !== m.begin.sourceBoundary || input.root.fragmentCount !== String(m.count) || input.root.finalFragmentHash !== m.frontier) throw new StorageInvalidCommandError('seal frontier mismatch');
    const base = await core.roots.capture(session, grant.scope);
    await checkPgStagedModule(core, session, grant, unit, 'seal', input.root, undefined, true);
    m.state = 'sealing';
    m.progress = { base, prepared: base.root, root: input.root, fragment: 0, section: 0, item: 0, phase: 0, offset: 0, checked: 0, records: 0, appends: 0,
      dependency: updatePortableDigest(startPortableDigest(), Buffer.from('["staged-dependency-root","v1",[')),
      effect: updatePortableDigest(startPortableDigest(), Buffer.from('["staged-effect-root","v1",[')) };
    await savePgUnit(core, session, grant, unit);
  }, true);
  try {
    return await core.tx.run(false, async (session) => {
      const unit = await resolvePgUnit(core, session, grant, input.unit, input.fence); const m = unit.metadata;
      if (m.state === 'sealed' || m.state === 'committed') return { state: m.state, checked: m.progress?.checked ?? 0, work: { items: 0, appends: 0, bytes: 0 }, seal: m.seal! };
      if (m.state !== 'sealing' || m.reason) throw new StorageInvalidCommandError('preparation requires abort and a fresh operation');
      const work = await core.roots.preparing(unit.id, () => preparePgStep(core, session, grant, unit, limits));
      await core.check(session, grant, 'write', true); await core.fence(session, grant, input.fence);
      await checkPgStagedModule(core, session, grant, unit, 'seal', input.root);
      await savePgUnit(core, session, grant, unit);
      return { state: m.state, checked: m.progress!.checked, work, ...(m.seal ? { seal: m.seal } : {}) };
    }, true);
  } catch (error) {
    if (isStorageError(error) && ['invalid-command', 'cas-conflict', 'idempotency-conflict'].includes(error.code)) {
      await core.tx.run(false, async (session) => {
        const unit = await resolvePgUnit(core, session, grant, input.unit, input.fence);
        if (unit.metadata.state === 'sealing') { unit.metadata.reason = `preparation-${error.code}`; await savePgUnit(core, session, grant, unit); }
      }).catch(() => undefined);
    }
    throw error;
  }
};
const fullReceipt = async (core: PgCore, session: PgSession, grant: ScopeGrant<unknown>, unit: PgUnit, receipt: CommitReceipt): Promise<CommitReceipt> => {
  if (!unit.metadata.moduleResultPayload) return ownPgValue(receipt);
  const moduleResult = decodePgJson<EncodedValue>(decodePgUtf8(await core.roots.readPayload(session, grant.scope, unit.metadata.moduleResultPayload)));
  return { ...ownPgValue(receipt), moduleResult };
};
export const commitPgStaged = async (core: PgCore, grant: ScopeGrant<unknown>, supplied: AuthenticatedStagedSeal, fence: WriterFence): Promise<CommitReceipt> => {
  const seal = ownPgValue(supplied);
  return core.tx.run(false, async (session) => {
    await core.check(session, grant, 'write', true); await core.fence(session, grant, fence);
    const base = await core.roots.capture(session, grant.scope, true);
    const unit = await readPgUnit(core, session, grant, seal.unitId); const m = unit.metadata;
    if (!m.seal || seal.capability !== m.seal.capability || encodeStagedCommitRoot(seal.commitRoot) !== encodeStagedCommitRoot(m.seal.commitRoot) || m.fence.fenceId !== fence.fenceId || m.fence.epoch !== fence.epoch) throw new StorageInvalidCommandError('seal ownership mismatch');
    await checkPgStagedModule(core, session, grant, unit, 'commit', seal.commitRoot);
    if (m.state === 'committed') return fullReceipt(core, session, grant, unit, m.receipt!);
    if (m.state !== 'sealed' || !m.progress) throw new StorageInvalidCommandError('unit is not sealed');
    const p = m.progress;
    if (base.version !== p.base.version || base.root !== p.base.root || base.sequence !== p.base.sequence) throw new StorageCasConflictError('scope changed after sealing');
    await checkPgStagedModule(core, session, grant, unit, 'commit', seal.commitRoot, undefined, true);
    const receipt: CommitReceipt = { commitId: m.commitId, moduleId: core.options.moduleId, scope: { ...grant.scope }, committedAt: core.now(), effectiveRecords: p.records, effectiveAppends: p.appends, journalCursor: (BigInt(base.sequence) + 1n).toString() };
    await core.check(session, grant, 'write', true); await core.fence(session, grant, fence);
    await core.roots.publish(session, grant.scope, base, p.prepared, receipt, m.begin.operationKey, true);
    m.state = 'committed'; m.receipt = receipt; m.progress = null;
    await savePgUnit(core, session, grant, unit);
    return fullReceipt(core, session, grant, unit, receipt);
  }, true);
};
export const abortPgStaged = async (core: PgCore, grant: ScopeGrant<unknown>, handle: AuthenticatedStagedHandle, fence: WriterFence, reason: string): Promise<void> => {
  if (typeof reason !== 'string' || !reason || reason.length > 4096) throw new StorageInvalidCommandError('abort requires a bounded reason');
  await core.tx.run(false, async (session) => {
    const unit = await resolvePgUnit(core, session, grant, handle, fence);
    if (unit.metadata.state === 'committed') throw new StorageInvalidCommandError('unit is already committed');
    unit.metadata.state = 'aborted'; unit.metadata.reason = reason; unit.metadata.progress = null;
    await savePgUnit(core, session, grant, unit);
  }, true);
};
