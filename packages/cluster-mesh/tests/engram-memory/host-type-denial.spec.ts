// Host type denial (lot E7, r2 P1-A). This spec runs under the
// typecheck gate (vitest `typecheck.include` + `tsconfig.test.json`): every
// `@ts-expect-error` directive must suppress exactly one intended error,
// and an unused directive fails compilation. Vitest strips types, so the
// runtime assertions below only guard behavior; the denial itself is proven
// by the typecheck run, not by this file executing.

import { describe, expect, it } from 'vitest';
import {
  assembleMemoryHostBinding,
  type MemoryHostBinding,
  type MemoryMaintainGrant,
} from '../../src/engram-memory/binding.js';
import { openMemoryMaintenance, type MemoryMaintenanceRunner } from '../../src/engram-memory/host-maintenance.js';
import { grantFor } from '../storage/authority-corpus.js';
import { StorageDeniedError } from '../../src/storage/errors.js';

const stubPool = {
  transaction: async () => ({ rows: [] as readonly unknown[] }),
};

const provider = () => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'c'.repeat(64) },
  serverFloor: '17.0.0',
  pool: stubPool,
});

const maintainOnly = () =>
  grantFor({
    token: 'memory-maintain-denial',
    moduleId: 'engram-memory',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    operations: ['read', 'maintain'],
  });

const stubRunner = (grant: unknown): MemoryMaintenanceRunner => {
  const fail = async (): Promise<never> => {
    throw new StorageDeniedError('no backend');
  };
  return {
    grant: grant as MemoryMaintenanceRunner['grant'],
    currentFence: fail,
    checkpoint: fail,
    poison: fail,
    retry: fail,
    resync: fail,
    snapshot: fail,
  };
};

describe('host type denial', () => {
  it('refuses combined grants at the host runner type', () => {
    const combined = grantFor({ moduleId: 'engram-memory', operations: ['read', 'write', 'maintain'] });
    // @ts-expect-error combined grants are not host maintain grants
    const rejected: MemoryMaintainGrant = combined;
    expect(rejected).toBe(combined);
    expect(() =>
      assembleMemoryHostBinding({ driver: provider(), maintainGrant: combined, invocationId: 'inv-type-1', storeId: 'store-1' }),
    ).toThrow(StorageDeniedError);
  });

  it('refuses the neutral grant at the binding type', () => {
    const binding = assembleMemoryHostBinding({
      driver: provider(),
      maintainGrant: maintainOnly(),
      invocationId: 'inv-type-1', storeId: 'store-1',
    });
    // Exactly one intended error: the neutral grant where the maintain
    // grant belongs. The runner is well-typed, so nothing else can error.
    // @ts-expect-error the neutral grant carries no maintain authority
    const neutralBinding: MemoryHostBinding = { ...binding, maintainGrant: binding.memoryGrant };
    expect(neutralBinding.memoryGrant).toBe(binding.memoryGrant);
    expect(() =>
      openMemoryMaintenance(
        { provider: provider(), maintainGrant: binding.memoryGrant } as never,
        stubRunner(maintainOnly()),
      ),
    ).toThrow(StorageDeniedError);
  });

  it('pins the exact operation tuples', () => {
    const binding = assembleMemoryHostBinding({
      driver: provider(),
      maintainGrant: maintainOnly(),
      invocationId: 'inv-type-1', storeId: 'store-1',
    });
    const neutral: readonly ['read', 'write'] = binding.memoryGrant.operations;
    expect([...neutral]).toEqual(['read', 'write']);
    const maintain: readonly ['read', 'maintain'] = binding.maintainGrant.operations;
    expect([...maintain]).toEqual(['read', 'maintain']);
    expect(binding.memoryOperations).toEqual(['read', 'write']);
  });
});
