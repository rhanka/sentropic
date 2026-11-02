import { IdentityCustodyErrorV1, type BusinessDeletionHandlerIdV1, type BusinessDeletionPortV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { prepareCmBusinessDeletion } from './cm-deletion-plan';
import { assertCmBusinessReferenceInventory, assertNoCmBusinessSubjectReferences,
  deleteCmBusinessSubjectReferences } from './cm-deletion-business-references';
import { deleteCmBusinessWorkspaces } from './cm-deletion-workspaces';

const sum = (left: Readonly<Record<string, number>>, right: Readonly<Record<string, number>>) => {
  const result = { ...left };
  for (const [table, count] of Object.entries(right)) result[table] = (result[table] ?? 0) + count;
  return result;
};

/** The coordinator supplies the one host handle; no app identity cleanup is duplicated here. */
export const createAppCmBusinessDeletion = (handlerId: BusinessDeletionHandlerIdV1): BusinessDeletionPortV1<PoolClient> => ({
  handlerId,
  async prepare(command, tx) {
    await assertCmBusinessReferenceInventory(tx);
    return prepareCmBusinessDeletion(command, tx);
  },
  async deleteRows(plan, tx) {
    const workspace = await deleteCmBusinessWorkspaces(plan.workspaceIdsToDelete, tx);
    const subject = await deleteCmBusinessSubjectReferences(plan.userId, tx);
    return { handlerId, deletedByTable: sum(workspace.deletedByTable, subject.deletedByTable),
      detachedByTable: sum(workspace.detachedByTable, subject.detachedByTable) };
  },
  async assertNoOrphans(plan, tx) {
    await assertNoCmBusinessSubjectReferences(plan.userId, tx);
    const result = await tx.hostTransaction.query('SELECT 1 FROM public.workspaces WHERE id = ANY($1::text[]) LIMIT 1',
      [plan.workspaceIdsToDelete]);
    if (result.rows.length) throw new IdentityCustodyErrorV1('identity_material_invalid');
  },
});
