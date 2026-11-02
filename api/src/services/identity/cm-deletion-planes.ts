import { IdentityCustodyErrorV1, type BusinessDeletionPlanV1, type PersonDeletionCommandV2,
  type PersonDeletionPlanePortV2 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import type { CmIdentityTransaction } from './cm-transaction';
import { createCmDeletionConnectorPlane } from './cm-deletion-connectors';

type Plane = PersonDeletionPlanePortV2<PoolClient>;
const mismatch = (): never => { throw new IdentityCustodyErrorV1('proof_binding_mismatch'); };

const remote: Plane = {
  step: 'remote_reader_sessions', placement: 'present',
  async apply(command) {
    // CM is already the local authority; files are a non-authorizing projection.
    return [{ step: 'remote_reader_sessions', subjectId: command.userId,
      targetKind: 'subject', targetRef: command.userId, custodyRef: null }];
  },
  async assertDeliveryInScope(command, _plan, draft) {
    if (draft.step !== 'remote_reader_sessions' || draft.subjectId !== command.userId
      || draft.targetKind !== 'subject' || draft.targetRef !== command.userId || draft.custodyRef !== null) mismatch();
  },
  async assertAbsent(command, _plan, tx) {
    const sessions = await tx.stores.sessions.listSessionsForUser(command.userId);
    if (sessions.some(session => session.status === 'active')) mismatch();
  },
};

/** This root binds F15 HTTP/conversation authority only. Future M4 authority
 * cannot inherit an absent declaration: deployed tables or scoped r13 runtime
 * authority require a real registered participant and block this composition. */
const assertUnboundPlaneInventory = async (command: PersonDeletionCommandV2, plan: BusinessDeletionPlanV1,
  tx: CmIdentityTransaction): Promise<void> => {
  const deployed = await tx.hostTransaction.query(`SELECT 1 FROM information_schema.tables
    WHERE table_schema IN ('public','control','cm_identity')
      AND table_name ~ '(agent|purpose|delegat)'
      AND table_name NOT IN ('agent_definitions') LIMIT 1`);
  if (deployed.rows.length) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
  const bindings = await tx.hostTransaction.query(`SELECT 1 FROM control.session_workspace_bindings
    WHERE status <> 'ended' AND (principal_id = $1 OR workspace_id = ANY($2::text[])) LIMIT 1`,
  [command.userId, plan.workspaceIdsToDelete]);
  const runtimes = await tx.hostTransaction.query(`SELECT 1 FROM control.cluster_mesh_registrations
    WHERE status = 'active' AND (nhi_principal_id = $1 OR custody_holder_principal_id = $1
      OR workspace_id = ANY($2::text[])) LIMIT 1`, [command.userId, plan.workspaceIdsToDelete]);
  if (bindings.rows.length || runtimes.rows.length) throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
};
const unbound = (step: 'agent_plane' | 'purpose_grants'): Plane => ({
  step, placement: 'absent',
  async apply() { throw new IdentityCustodyErrorV1('identity_cascade_participant_missing'); },
  async assertDeliveryInScope() { throw new IdentityCustodyErrorV1('identity_cascade_participant_missing'); },
  assertAbsent: assertUnboundPlaneInventory,
});

const catalogue: Plane = {
  step: 'catalogue', placement: 'present',
  async apply(command, _plan, tx) {
    await tx.advanceSubjectRevision(command.userId, new Date().toISOString(), false);
    return [];
  },
  async assertDeliveryInScope() { mismatch(); },
  async assertAbsent(command, _plan, tx) {
    // Every tool dispatch rereads F15; no cached decision outlives this absence.
    if (await tx.stores.accounts.findAccount(command.userId)) mismatch();
    if ((await tx.conversations.listSessionsForUser(command.userId)).length) mismatch();
  },
};

export const createAppCmDeletionPlanes = (): readonly Plane[] => [
  remote, createCmDeletionConnectorPlane(), unbound('agent_plane'), unbound('purpose_grants'), catalogue,
];
