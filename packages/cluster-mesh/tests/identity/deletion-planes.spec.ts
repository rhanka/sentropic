import { describe, expect, it } from 'vitest';
import { createAtomicPersonDeletionV2, acknowledgeIdentityRevocationV1, IdentityCustodyErrorV1 } from '../../src/index.js';
import type { AtomicPersonDeletionInput, CustodyOpHost, PersonDeletionPlanePortV2 } from '../../src/index.js';
import { asOpHost, NOW, LATER, openPostgresEnv, openSqliteEnv, pgEnabled } from './a20b-helpers.js';

const WRITE = { mode: 'write' as const, purpose: 'delete' as const, maxAttempts: 3 as const, deadlineMs: 8000 };
const READ = { ...WRITE, mode: 'read' as const };
const steps = ['remote_reader_sessions', 'connector_grants', 'agent_plane', 'purpose_grants', 'catalogue'] as const;
const absentPlanes = (): PersonDeletionPlanePortV2<CustodyOpHost>[] => steps.map((step) => ({
  step, placement: 'absent', apply: async () => { throw new Error('absent plane applied'); },
  assertDeliveryInScope: async () => { throw new Error('absent plane scope'); }, assertAbsent: async () => undefined,
}));
const command = { userId: 'person', actorId: 'person', handlerId: 'self_account' as const, operationId: 'delete-person' };

describe.each(pgEnabled ? ['sqlite', 'postgres'] as const : ['sqlite'] as const)('deletion planes on %s', (profile) => {
  const setup = async (): Promise<AtomicPersonDeletionInput<CustodyOpHost>> => {
    const unitOfWork = asOpHost(profile === 'postgres' ? (await openPostgresEnv()).unitOfWork : openSqliteEnv().unitOfWork);
    await unitOfWork.run(WRITE, async (tx) => {
      await tx.hostTransaction.journal.insertAccountCore({ userId: 'person', email: 'person@example.test', accountStatus: 'disabled', globalRole: 'editor', createdAt: NOW, updatedAt: NOW });
      await tx.hostTransaction.journal.ensureLiveFence('person', NOW);
    });
    return {
      unitOfWork, planes: absentPlanes(), clock: () => NOW, authorization: { assertAllowed: async () => undefined },
      transactionOptions: { reservation: WRITE, deletion: WRITE, diagnostic: WRITE, read: READ },
      business: { handlerId: 'self_account', prepare: async () => ({ userId: 'person', workspaceIdsToDelete: [], retainedWorkspaceIds: [] }),
        deleteRows: async () => ({ handlerId: 'self_account', deletedRows: {} }), assertNoOrphans: async () => undefined },
    };
  };

  it('requires exactly five planes and their explicit scope assertions', async () => {
    const base = await setup();
    for (const planes of [[], [...base.planes, base.planes[0]], base.planes.map((p) => p.step === 'connector_grants' ? { ...p, assertDeliveryInScope: undefined } : p)]) {
      expect(() => createAtomicPersonDeletionV2({ ...base, planes } as AtomicPersonDeletionInput<CustodyOpHost>)).toThrow(expect.objectContaining({ code: 'identity_cascade_participant_missing' }));
    }
  });

  it('enqueues in the deletion transaction and derives completion from acknowledgement', async () => {
    const base = await setup();
    let scopeCalls = 0;
    const remote: PersonDeletionPlanePortV2<CustodyOpHost> = {
      step: 'remote_reader_sessions', placement: 'present',
      apply: async () => [{ step: 'remote_reader_sessions', subjectId: 'person', targetKind: 'login_session', targetRef: 'session', custodyRef: null }],
      assertDeliveryInScope: async (_command, _plan, _draft, tx) => { scopeCalls += 1; expect(await tx.revocationOutbox.listPending(command.operationId)).toEqual([]); },
      assertAbsent: async (_command, _plan, tx) => { expect(await tx.revocationOutbox.listPending(command.operationId)).toHaveLength(1); },
    };
    const deletion = createAtomicPersonDeletionV2({ ...base, planes: [remote, ...base.planes.slice(1)] });
    const receipt = await deletion.deletePerson(command);
    expect(scopeCalls).toBe(1);
    expect(receipt).toMatchObject({ contractVersion: '2.0.0', operationId: command.operationId, transaction: 'committed', complete: false });
    expect(receipt.steps[1]).toEqual({ step: 'remote_reader_sessions', outcome: 'queued', detailCode: 'external_delivery_pending' });
    const [claim] = await base.unitOfWork.run(WRITE, (tx) => tx.revocationOutbox.claimPending({ workerId: 'worker', now: NOW, leaseUntil: LATER, limit: 1 }));
    await base.unitOfWork.run(WRITE, (tx) => acknowledgeIdentityRevocationV1({ tx, claim, at: NOW, connectorCustody: null }));
    expect(await deletion.getReceipt(command.operationId)).toMatchObject({ complete: true, steps: expect.arrayContaining([{ step: 'remote_reader_sessions', outcome: 'applied', detailCode: 'external_delivery_complete' }]) });
    expect((await deletion.getOperation(command.operationId))?.committedReceipt?.complete).toBe(false);
    expect((await deletion.deletePerson(command)).complete).toBe(true);
    expect(scopeCalls).toBe(1);
  });

  it('rolls back scope assertion failure without any delivery or deleted account', async () => {
    const base = await setup();
    const connector: PersonDeletionPlanePortV2<CustodyOpHost> = {
      ...base.planes[1], placement: 'present',
      apply: async () => [{ step: 'connector_grants', subjectId: 'other-owner', targetKind: 'connector_grant', targetRef: 'foreign', custodyRef: 'copy' }],
      assertDeliveryInScope: async () => { throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid'); },
    };
    const receipt = await createAtomicPersonDeletionV2({ ...base, planes: base.planes.map((p) => p.step === connector.step ? connector : p) }).deletePerson(command);
    expect(receipt).toMatchObject({ transaction: 'rolled_back', complete: false, deliveryIds: [], cleanup: null });
    expect(receipt.steps[2]).toEqual({ step: 'connector_grants', outcome: 'queued', detailCode: 'required_local_step_failed' });
    await base.unitOfWork.run(READ, async (tx) => {
      expect(await tx.stores.accounts.findById('person')).not.toBeNull();
      expect(await tx.revocationOutbox.listPending(command.operationId)).toEqual([]);
    });
  });
});
