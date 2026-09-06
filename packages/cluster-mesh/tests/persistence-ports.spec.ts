import { describe, expect, it, vi } from 'vitest';
import {
  selectClusterMeshPersistence,
  type ClusterMeshPersistencePorts,
} from '../src/persistence/ports.js';

function ports(): ClusterMeshPersistencePorts {
  return {
    runtime: {
      find: vi.fn(async () => null),
      append: vi.fn(async () => undefined),
      saveGeneration: vi.fn(async () => undefined),
      saveRegistration: vi.fn(async () => undefined),
      reserveCapacity: vi.fn(async () => ({ ok: true, outcome: 'reserved' as const })),
      reclaimExpiredCapacity: vi.fn(async () => 0),
      saveMcpServer: vi.fn(async () => undefined),
      enqueueCommand: vi.fn(async () => true),
    },
    cutovers: {
      find: vi.fn(async () => null),
      activate: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    },
    backfill: {
      verifyFromEmpty: vi.fn(async () => ({
        strategy: 'N-A-from-empty' as const,
        sourceRows: 0 as const,
        migratedRows: 0 as const,
      })),
    },
    rollback: {
      verifyRollback: vi.fn(async () => ({ reversible: true })),
    },
  };
}

describe('cluster mesh persistence ports', () => {
  it('should select injected durable adapters', () => {
    const durable = ports();
    expect(selectClusterMeshPersistence({ mode: 'DURABLE', durable })).toBe(durable);
  });

  it('should keep LOCAL_ONLY on local ports without an app mirror', async () => {
    const local = ports();
    const binding = { mode: 'LOCAL_ONLY' as const, local };

    expect(selectClusterMeshPersistence(binding)).toBe(local);
    expect(Object.keys(binding)).toEqual(['mode', 'local']);
    await expect(local.backfill.verifyFromEmpty()).resolves.toEqual({
      strategy: 'N-A-from-empty',
      sourceRows: 0,
      migratedRows: 0,
    });
  });
});
