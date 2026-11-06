import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * a4-cm-gaps-r2 §2.3.1: `PersonDeletionCommandV2.handlerId` is required and the
 * runtime refuses a missing handler (`identity_material_invalid`), so both app
 * entry points must pass the same handler id they build the coordinator with.
 */

const mocks = vi.hoisted(() => {
  const deletePerson = vi.fn(async () => ({ receipt: 'stub' }));
  const createAtomicPersonDeletionV2 = vi.fn(() => ({ deletePerson }));
  return { deletePerson, createAtomicPersonDeletionV2 };
});
const { deletePerson } = mocks;

vi.mock('@sentropic/cluster-mesh', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sentropic/cluster-mesh')>();
  return { ...mod, createAtomicPersonDeletionV2: mocks.createAtomicPersonDeletionV2 };
});

import { deleteCmAccountAsAdmin, deleteOwnCmAccount } from '../../../src/services/identity/cm-account-deletion';

// Synthetic qualification budgets only; loadCmDeletionOptions refuses an unset
// CM_IDENTITY_DELETION_BUDGETS_JSON (identity_material_missing) before any command runs.
vi.stubEnv('CM_IDENTITY_DELETION_BUDGETS_JSON', JSON.stringify({
  reservation: { deadlineMs: 1000, maxAttempts: 1 },
  deletion: { deadlineMs: 1000, maxAttempts: 1 },
  diagnostic: { deadlineMs: 1000, maxAttempts: 1 },
  read: { deadlineMs: 1000, maxAttempts: 1 },
  qualificationReceiptRef: 'synthetic-api-test-only',
}));

describe('cm-account-deletion command shape (a4-cm-gaps-r2 §2.3.1)', () => {
  beforeEach(() => { deletePerson.mockClear(); });

  it('passes handlerId self_account on self deletion', async () => {
    await deleteOwnCmAccount('user-self');
    expect(deletePerson).toHaveBeenCalledWith(expect.objectContaining({
      handlerId: 'self_account', userId: 'user-self', actorId: 'user-self',
    }));
  });

  it('passes handlerId admin_account on admin deletion', async () => {
    await deleteCmAccountAsAdmin({ userId: 'user-target', actorId: 'actor-admin' });
    expect(deletePerson).toHaveBeenCalledWith(expect.objectContaining({
      handlerId: 'admin_account', userId: 'user-target', actorId: 'actor-admin',
    }));
  });

  it('always sends an operationId with the handlerId', async () => {
    await deleteOwnCmAccount('user-self-3', 'op-self-3');
    expect(deletePerson).toHaveBeenCalledWith(expect.objectContaining({
      handlerId: 'self_account', operationId: 'op-self-3',
    }));
  });
});
