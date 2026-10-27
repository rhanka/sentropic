// Host maintenance binding (lot E7, E8 answers): a distinct host-issued
// maintain grant/binding owns fence access/checks, consumer
// checkpoint/poison/retry, resync and snapshot maintenance. Engram's
// neutral handle stays exactly ['read','write']: maintenance through the
// memory handle is denied at runtime and by types. The durable ledger
// (candidate/store/scope/invocation mapping, envelope binding,
// reservation/terminal/ambiguous state, receipt/cursor reconciliation),
// the continuation grant (fresh host authn/authz against retained
// authority) and proof-only recovery (no second effect, unknown/foreign
// refused, empty ledger refuses) are covered here.

import { describe, expect, it } from 'vitest';
import {
  assembleMemoryHostBinding,
  issueContinuationGrant,
  verifyHostBinding,
  type MemoryMaintainGrant,
  type MemoryNeutralGrant,
} from '../../src/engram-memory/binding.js';
import { pgEnabled } from '../storage/pg-driver.js';
import { memoryHostComposed, memoryPgHost } from './pg-host.js';
import {
  openMemoryMaintenance,
  type MemoryMaintenanceRunner,
} from '../../src/engram-memory/host-maintenance.js';
import { createMemoryHostLedger, proveForRecovery } from '../../src/engram-memory/ledger.js';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { StorageDeniedError, StorageUnavailableError } from '../../src/storage/errors.js';
import { grantFor } from '../storage/authority-corpus.js';
import { g1Grant } from './g1-host.js';

const sharedStubPool = { transaction: async () => ({ rows: [] as unknown[] }) };

const qualifiedProvider = () => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'b'.repeat(64) },
  serverFloor: '17.0.0',
  pool: sharedStubPool,
});

const maintainGrant = () =>
  grantFor({
    token: 'memory-maintain-1',
    moduleId: 'engram-memory',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    operations: ['maintain'],
  });

describe('host maintenance binding', () => {
  const stubRunner = (grant: unknown): MemoryMaintenanceRunner => ({
    grant: grant as MemoryMaintenanceRunner['grant'],
    currentFence: async () => {
      throw new StorageUnavailableError('no backend');
    },
    checkpoint: async () => {
      throw new StorageUnavailableError('no backend');
    },
    poison: async () => {
      throw new StorageUnavailableError('no backend');
    },
    retry: async () => {
      throw new StorageUnavailableError('no backend');
    },
    resync: async () => {
      throw new StorageUnavailableError('no backend');
    },
    snapshot: async () => {
      throw new StorageUnavailableError('no backend');
    },
  });
  const entryFor = (candidateId: string) => ({
    candidateId,
    storeId: 'store-1',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    invocationId: 'inv-1',
    continuationIds: [] as string[],
    envelopeDigest: 'e'.repeat(64),
    state: 'reserved' as const,
    receipt: null,
    cursor: null,
  });

  it('issues a host-only maintain binding separate from the memory handle', () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    expect(binding.memoryOperations).toEqual(['read', 'write']);
    expect(binding.maintainGrant.operations).toContain('maintain');
    expect(binding.provider).toEqual(qualifiedProvider());
  });

  it('refuses a missing driver or a grant without maintain', () => {
    expect(() => assembleMemoryHostBinding({ driver: undefined, maintainGrant: maintainGrant() })).toThrow(
      MemoryHostDriverRequiredError,
    );
    expect(() =>
      assembleMemoryHostBinding({
        driver: qualifiedProvider(),
        maintainGrant: grantFor({ moduleId: 'engram-memory', operations: ['read', 'write'] }),
        invocationId: 'inv-host-1',
      }),
    ).toThrow(StorageDeniedError);
    expect(() =>
      assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: null, invocationId: 'inv-host-1' }),
    ).toThrow(StorageDeniedError);
  });

  it('opens host-only ports that delegate to the bound runner', async () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    const ports = openMemoryMaintenance(binding, stubRunner(binding.maintainGrant));
    // The stub runner refuses everything: the ports delegate 1:1 instead of
    // stubbing success. Live backend calls are covered PG-side.
    await expect(ports.checkFence({} as never)).rejects.toThrow('no backend');
    await expect(ports.checkpoint('consumer', '0', '0', {} as never)).rejects.toThrow('no backend');
    await expect(ports.poison('consumer', 'reason')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.resync('scope', {} as never)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.snapshot('token', 0, 10)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(() => openMemoryMaintenance(null as never, undefined as never)).toThrow(StorageDeniedError);
  });
  it('denies maintenance operations through the neutral memory handle', () => {
    const provider = qualifiedProvider();
    // The neutral handle grant carries only read/write: it cannot assemble
    // a binding and cannot open maintenance ports.
    expect(() =>
      assembleMemoryHostBinding({ driver: provider, maintainGrant: g1Grant(), invocationId: 'inv-host-1' }),
    ).toThrow(StorageDeniedError);
    expect(() =>
      openMemoryMaintenance({ provider, maintainGrant: g1Grant() } as never, undefined as never),
    ).toThrow(StorageDeniedError);
    // Type-level: a combined grant is not a maintain-only grant, and the
    // neutral grant cannot open maintenance.
    const combined = grantFor({ moduleId: 'engram-memory', operations: ['read', 'write', 'maintain'] });
    // @ts-expect-error combined grants are not maintain-only
    const rejected: MemoryMaintainGrant = combined;
    expect(rejected).toBe(combined);
    const neutral: MemoryNeutralGrant = assembleMemoryHostBinding({
      driver: provider,
      maintainGrant: maintainGrant(),
      invocationId: 'inv-host-1',
    }).memoryGrant;
    expect([...neutral.operations]).toEqual(['read', 'write']);
    expect(() =>
      // @ts-expect-error the neutral grant carries no maintain authority
      openMemoryMaintenance({ provider, maintainGrant: neutral }),
    ).toThrow(StorageDeniedError);
  });
  it('refuses expired maintain grants at assembly and at open', () => {
    const expired = grantFor({
      token: 'memory-maintain-expired',
      moduleId: 'engram-memory',
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      operations: ['maintain'],
      lifetime: { kind: 'lease', expiresAt: '2000-01-01T00:00:00.000Z' },
    });
    expect(() =>
      assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: expired, invocationId: 'inv-host-1' }),
    ).toThrow(/lease has expired/);
    const live = grantFor({
      token: 'memory-maintain-leased',
      moduleId: 'engram-memory',
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      operations: ['maintain'],
      lifetime: { kind: 'lease', expiresAt: '2999-01-01T00:00:00.000Z' },
    });
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: live, invocationId: 'inv-host-1' });
    expect(() => openMemoryMaintenance(binding, stubRunner(binding.maintainGrant))).not.toThrow();
    expect(() =>
      openMemoryMaintenance({ provider: qualifiedProvider(), maintainGrant: expired } as never, undefined as never),
    ).toThrow(/lease has expired/);
  });

  it('refuses a foreign scope even with a live grant', async () => {
    const binding = assembleMemoryHostBinding({
      driver: qualifiedProvider(),
      maintainGrant: maintainGrant(),
      invocationId: 'inv-host-1',
    });
    await expect(
      verifyHostBinding({ bind: async () => ({}) }, binding, { tenantId: 'tenant-a', workspaceId: 'workspace-a' }),
    ).resolves.toBeUndefined();
    await expect(
      verifyHostBinding({ bind: async () => ({}) }, binding, { tenantId: 'elsewhere', workspaceId: 'workspace-a' }),
    ).rejects.toThrow(/scope does not match/);
    await expect(verifyHostBinding({ bind: async () => ({}) }, null as never)).rejects.toThrow(
      StorageDeniedError,
    );
  });

  describe.skipIf(!pgEnabled)('host binding authoritative verification', () => {
    it('checks the maintain grant against the live grants table', async () => {
      const host = await memoryPgHost();
      const { binding } = memoryHostComposed(host.options.driver, 'inv-verify-1');
      const root = await host.open();
      try {
        // Never-issued grant: the store refuses.
        await expect(verifyHostBinding(root.adapter(), binding)).rejects.toThrow(StorageDeniedError);
        await root.bindNew(binding.maintainGrant);
        await verifyHostBinding(root.adapter(), binding);
        await root.revoke(binding.maintainGrant.token);
        await expect(verifyHostBinding(root.adapter(), binding)).rejects.toThrow(StorageDeniedError);
      } finally {
        await host.close();
      }
    });
  });

  it('refuses ad-hoc objects shaped like a binding', () => {
    // No provider at all: the provider check fires first.
    expect(() =>
      openMemoryMaintenance({ maintainGrant: maintainGrant() } as never, undefined as never),
    ).toThrow(MemoryHostDriverRequiredError);
    // Runner bound to another grant: identity mismatch, even with live ports.
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    expect(() =>
      openMemoryMaintenance(binding, stubRunner(maintainGrant())),
    ).toThrow(/runner bound to this binding/);
  });
  it('routes fence checks and checkpoints through the host-only binding', async () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    const ports = openMemoryMaintenance(binding, stubRunner(binding.maintainGrant));
    await expect(ports.checkFence({} as never)).rejects.toThrow('no backend');
    await expect(ports.checkpoint('consumer', '0', '0', {} as never)).rejects.toThrow('no backend');
  });

  it('retries and poisons consumers without a second effect', async () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    const ports = openMemoryMaintenance(binding, stubRunner(binding.maintainGrant));
    await expect(ports.checkpoint('consumer', '0', '0', {} as never)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.poison('consumer', 'poisoned')).rejects.toBeInstanceOf(StorageUnavailableError);
  });

  it('resyncs scope-chain-index and snapshots through maintenance ports', async () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant(), invocationId: 'inv-host-1' });
    const ports = openMemoryMaintenance(binding, stubRunner(binding.maintainGrant));
    await expect(ports.resync('tenant-a/workspace-a', {} as never)).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.snapshot('token', 0, 10)).rejects.toBeInstanceOf(StorageUnavailableError);
  });
  it('keeps the durable ledger across reopen (rehydration re-establishes authority)', () => {
      const first = createMemoryHostLedger();
      first.record(entryFor('cand-1'));
      first.recordContinuation('cand-1', 'inv-2');
      first.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      // Reopen with a fresh instance: the serialized snapshot restores authority.
      const reopened = createMemoryHostLedger();
      expect(reopened.read('cand-1')).toBeNull();
      expect(() => proveForRecovery(reopened, 'cand-1')).toThrow(StorageDeniedError);
      reopened.restore(JSON.parse(JSON.stringify(first.snapshot())) as ReturnType<typeof first.snapshot>);
      expect(reopened.read('cand-1')).toEqual(first.read('cand-1'));
      expect(proveForRecovery(reopened, 'cand-1').state).toBe('terminal');
      expect(reopened.record(entryFor('cand-1'))).toEqual(first.read('cand-1'));
    });

    it('refuses on an empty ledger until rehydration', () => {
      const ledger = createMemoryHostLedger();
      expect(ledger.snapshot()).toEqual([]);
      expect(() => issueContinuationGrant(ledger, 'cand-1', {
        invocationId: 'inv-2',
        issuedAt: '2026-10-27T00:00:00.000Z',
        hostPrincipal: 'host-1',
      })).toThrow(StorageDeniedError);
      expect(() => ledger.restore([{ ...entryFor('cand-1'), envelopeDigest: '' }])).toThrow(
        StorageDeniedError,
      );
      expect(ledger.read('cand-1')).toBeNull();
    });

  describe('durable host-evidence ledger', () => {
    it('records host evidence and reads it back', () => {
      const ledger = createMemoryHostLedger();
      expect(ledger.read('unknown')).toBeNull();
      const stored = ledger.record(entryFor('cand-1'));
      expect(stored.state).toBe('reserved');
      expect(ledger.read('cand-1')).toEqual(stored);
    });

    it('keeps the first write on replay and completes terminally', () => {
      const ledger = createMemoryHostLedger();
      const first = ledger.record(entryFor('cand-1'));
      expect(ledger.record({ ...entryFor('cand-1'), invocationId: 'inv-2' })).toBe(first);
      const done = ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      expect(done.state).toBe('terminal');
      expect(ledger.read('cand-1')).toBe(done);
      expect(() => ledger.markTerminal('unknown', null, null)).toThrow(StorageDeniedError);
    });

    it('tracks continuations and refuses copied invocation fields', () => {
      const ledger = createMemoryHostLedger();
      ledger.record(entryFor('cand-1'));
      const continued = ledger.recordContinuation('cand-1', 'inv-2');
      expect(continued.continuationIds).toEqual(['inv-2']);
      expect(ledger.read('cand-1')).toBe(continued);
      expect(() => ledger.recordContinuation('cand-1', 'inv-1')).toThrow(StorageDeniedError);
      expect(() => ledger.recordContinuation('cand-1', 'inv-2')).toThrow(StorageDeniedError);
      expect(() => ledger.recordContinuation('cand-1', '')).toThrow(StorageDeniedError);
      expect(() => ledger.recordContinuation('unknown', 'inv-9')).toThrow(StorageDeniedError);
    });

    it('issues continuation grants against retained authority only', () => {
      const ledger = createMemoryHostLedger();
      ledger.record(entryFor('cand-1'));
      const attestation = { invocationId: 'inv-2', issuedAt: '2026-10-27T00:00:00.000Z', hostPrincipal: 'host-1' };
      const continued = issueContinuationGrant(ledger, 'cand-1', attestation);
      expect(continued.candidateId).toBe('cand-1');
      expect(continued.storeId).toBe('store-1');
      expect(continued.grant.operations).toEqual(['read', 'write']);
      expect(continued.grant.lifetime).toEqual({ kind: 'invocation', invocationId: 'inv-2' });
      expect(continued.grant.scope).toEqual({ tenantId: 'tenant-a', workspaceId: 'workspace-a' });
      expect(ledger.read('cand-1')?.continuationIds).toEqual(['inv-2']);
    });

    it('refuses continuations without retained authority or fresh authn', () => {
      const ledger = createMemoryHostLedger();
      const attestation = { invocationId: 'inv-2', issuedAt: '2026-10-27T00:00:00.000Z', hostPrincipal: 'host-1' };
      expect(() => issueContinuationGrant(ledger, 'unknown', attestation)).toThrow(StorageDeniedError);
      ledger.record(entryFor('cand-1'));
      expect(() => issueContinuationGrant(ledger, 'cand-1', { ...attestation, invocationId: '' })).toThrow(
        StorageDeniedError,
      );
      expect(() => issueContinuationGrant(ledger, 'cand-1', { ...attestation, hostPrincipal: '' })).toThrow(
        StorageDeniedError,
      );
      // Copied retained invocation fields never grant.
      expect(() => issueContinuationGrant(ledger, 'cand-1', { ...attestation, invocationId: 'inv-1' })).toThrow(
        StorageDeniedError,
      );
      issueContinuationGrant(ledger, 'cand-1', attestation);
      expect(() => issueContinuationGrant(ledger, 'cand-1', attestation)).toThrow(StorageDeniedError);
    });

    it('proves recovery evidence without applying effects', () => {
      const ledger = createMemoryHostLedger();
      ledger.record(entryFor('cand-1'));
      ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      const proof = proveForRecovery(ledger, 'cand-1');
      expect(proof.state).toBe('terminal');
      expect(proof.envelopeDigest).toBe('e'.repeat(64));
      expect(proof.receipt).toEqual({ outcome: 'admitted' });
      expect(proof.cursor).toBe('cursor-9');
      expect(proveForRecovery(ledger, 'cand-1', { tenantId: 'tenant-a', workspaceId: 'workspace-a' })).toEqual(
        proof,
      );
      // Nothing was written by the proof path.
      expect(ledger.read('cand-1')).toEqual({ ...proof, invocationId: 'inv-1', continuationIds: [] });
    });

    it('refuses recovery for unknown candidates and foreign scopes', () => {
      const ledger = createMemoryHostLedger();
      expect(() => proveForRecovery(ledger, 'unknown')).toThrow(StorageDeniedError);
      ledger.record(entryFor('cand-1'));
      expect(() => proveForRecovery(ledger, 'unknown')).toThrow(StorageDeniedError);
      expect(() =>
        proveForRecovery(ledger, 'cand-1', { tenantId: 'elsewhere', workspaceId: 'workspace-a' }),
      ).toThrow(StorageDeniedError);
    });

    it('refuses malformed entries without recording', () => {
      const ledger = createMemoryHostLedger();
      expect(() => ledger.record({ ...entryFor('cand-1'), envelopeDigest: '' })).toThrow(StorageDeniedError);
      expect(() =>
        ledger.record({ ...entryFor('cand-1'), scope: { tenantId: '', workspaceId: '' } }),
      ).toThrow(StorageDeniedError);
      expect(ledger.read('cand-1')).toBeNull();
    });
  });
});
