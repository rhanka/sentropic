import { describe, expect, it, vi } from 'vitest';

/**
 * a4-cm-gaps-r2 §2.3.1: `PersonDeletionCommandV2.handlerId` is required and the
 * runtime refuses a missing handler (`identity_material_invalid`), so both app
 * entry points must pass the same handler id they build the coordinator with.
 */

const deletePerson = vi.fn(async () => ({ receipt: 'stub' }));
const createAtomicPersonDeletionV2 = vi.fn(() => ({ deletePerson }));

vi.mock('@sentropic/cluster-mesh', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@sentropic/cluster-mesh')>();
  return { ...mod, createAtomicPersonDeletionV2 };
});

import { deleteCmAccountAsAdmin, deleteOwnCmAccount } from '../../../src/services/identity/cm-account-deletion';

describe('cm-account-deletion command shape (a4-cm-gaps-r2 §2.3.1)', () => {
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
