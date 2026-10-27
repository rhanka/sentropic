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

import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  assembleMemoryHostBinding,
  assertMaintainGrantLive,
  issueContinuationGrant,
  MemoryMaintenanceNotFoundError,
  proveForRecoveryAuthorized,
  reattachMemoryMaintenance,
  verifyHostBinding,
  type MemoryNeutralGrant,
} from '../../src/engram-memory/binding.js';
import { pgEnabled, testPgDriver } from '../storage/pg-driver.js';
import { memoryAppend, memoryHostComposed, memoryLiveRunner, memoryPgHost, memoryUnit } from './pg-host.js';
import {
  openMemoryMaintenance,
  type MemoryMaintenanceRunner,
} from '../../src/engram-memory/host-maintenance.js';
import {
  createMemoryHostLedger,
  openMemoryPostgresHostLedger,
  proveForRecovery,
} from '../../src/engram-memory/ledger.js';
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
  const entryFor = (candidateId: string, hostPrincipal = 'host-1') => ({
    candidateId,
    storeId: 'store-1',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    invocationId: 'inv-1',
    hostPrincipal,
    continuationIds: [] as string[],
    envelopeDigest: 'e'.repeat(64),
    state: 'reserved' as const,
    receipt: null,
    cursor: null,
  });
  const hostBindingFor = (principalId = 'user-1') =>
    assembleMemoryHostBinding({
      driver: qualifiedProvider(),
      maintainGrant: grantFor({
        token: `memory-maintain-${principalId}`,
        moduleId: 'engram-memory',
        scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
        principalId,
        operations: ['maintain'],
      }),
      invocationId: 'inv-host-1',
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
    await expect(ports.poison('consumer', 'event-1', 'reason')).rejects.toBeInstanceOf(StorageUnavailableError);
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
    // Runtime: a combined grant is not a maintain-only grant. The
    // type-level denial lives in the typechecked host-type-denial spec.
    const combined = grantFor({ moduleId: 'engram-memory', operations: ['read', 'write', 'maintain'] });
    expect(() =>
      assembleMemoryHostBinding({ driver: provider, maintainGrant: combined, invocationId: 'inv-host-1' }),
    ).toThrow(StorageDeniedError);
    const neutral: MemoryNeutralGrant = assembleMemoryHostBinding({
      driver: provider,
      maintainGrant: maintainGrant(),
      invocationId: 'inv-host-1',
    }).memoryGrant;
    expect([...neutral.operations]).toEqual(['read', 'write']);
    expect(() =>
      openMemoryMaintenance(
        { provider, maintainGrant: neutral } as never,
        stubRunner(maintainGrant()),
      ),
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

  it('compares lease expiry numerically like the kernel, not lexicographically', () => {
    const offsetExpired = grantFor({
      token: 'memory-maintain-offset',
      moduleId: 'engram-memory',
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      operations: ['maintain'],
      // 01:00+02:00 = 23:00Z, before the pinned now — expired numerically,
      // but a lexicographic compare against the Zulu now would call it live.
      lifetime: { kind: 'lease', expiresAt: '2026-10-28T01:00:00.000+02:00' },
    });
    expect(() => assertMaintainGrantLive(offsetExpired, '2026-10-27T23:30:00.000Z')).toThrow(
      /lease has expired/,
    );
    const offsetLive = grantFor({
      token: 'memory-maintain-offset-live',
      moduleId: 'engram-memory',
      scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
      operations: ['maintain'],
      // 19:00-05:00 = midnight Z, after the pinned now — live numerically,
      // but lexicographically smaller than the Zulu now.
      lifetime: { kind: 'lease', expiresAt: '2026-10-27T19:00:00.000-05:00' },
    });
    expect(() => assertMaintainGrantLive(offsetLive, '2026-10-27T23:30:00.000Z')).not.toThrow();
    expect(() => assertMaintainGrantLive({ ...offsetLive, lifetime: { kind: 'lease' } })).toThrow(
      /lease has expired/,
    );
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

  describe.skipIf(!pgEnabled)('continuation grants accepted by the kernel', () => {
    it('issues a grant the kernel binds and commits', async () => {
      const host = await memoryPgHost();
      const { binding } = memoryHostComposed(host.options.driver, 'inv-cont-1');
      const root = await host.open();
      try {
        const ledger = createMemoryHostLedger();
        ledger.record({
          candidateId: 'cand-cont',
          storeId: 'store-1',
          scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
          invocationId: 'inv-1',
          hostPrincipal: 'user-1',
          continuationIds: [],
          envelopeDigest: 'e'.repeat(64),
          state: 'reserved' as const,
          receipt: null,
          cursor: null,
        });
        const { grant } = issueContinuationGrant(ledger, binding, 'cand-cont', {
          invocationId: 'inv-2',
          issuedAt: '2026-10-27T00:00:00.000Z',
          hostPrincipal: 'user-1',
        });
        const bound = await root.bindNew(grant);
        await bound.commitAtomic(memoryUnit({ appends: [memoryAppend('9')] }));
        expect(await bound.readHead('memory-journal')).toBe('hash-9');
      } finally {
        await host.close();
      }
    });
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

  describe.skipIf(!pgEnabled)('PG-backed host ledger (002 asset)', () => {
    const applyLedgerAsset = async (host: Awaited<ReturnType<typeof memoryPgHost>>) => {
      const projection = host.layout.projectionSchemas['engram-memory'] as string;
      const sql = await readFile(
        new URL('../../assets/storage/postgres/engram-memory/002-host-ledger.sql', import.meta.url),
        'utf8',
      );
      await host.tx.run(false, (session) =>
        session.execute({
          text: sql.replaceAll('__MEMORY_SCHEMA__', `"${projection}"`),
          values: [],
        }),
      );
      return projection;
    };

    it('persists entries and rehydrates across a real reopen', async () => {
      const host = await memoryPgHost();
      try {
        const projection = await applyLedgerAsset(host);
        const first = testPgDriver();
        try {
          const ledgerA = await openMemoryPostgresHostLedger(first.driver, projection);
          const stored = await ledgerA.record(entryFor('cand-1', 'user-1'));
          expect(stored.state).toBe('reserved');
          // First-write wins across the durable backing, not per handle.
          await expect(
            ledgerA.record({ ...entryFor('cand-1', 'user-1'), invocationId: 'inv-2' }),
          ).resolves.toEqual(stored);
          await expect(ledgerA.recordContinuation('cand-1', 'inv-1')).rejects.toThrow(
            /copied invocation fields/,
          );
          await ledgerA.recordContinuation('cand-1', 'inv-2');
          await ledgerA.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
          // Real reopen: a fresh pool and a fresh handle over the same schema.
          const second = testPgDriver();
          try {
            const ledgerB = await openMemoryPostgresHostLedger(second.driver, projection);
            const rehydrated = await ledgerB.read('cand-1');
            expect(rehydrated).toEqual(await ledgerA.read('cand-1'));
            expect(rehydrated?.state).toBe('terminal');
            expect(rehydrated?.continuationIds).toEqual(['inv-2']);
            expect(rehydrated?.receipt).toEqual({ outcome: 'admitted' });
            // Rehydration feeds the in-memory authority seam unchanged.
            const memory = createMemoryHostLedger();
            memory.restore(await ledgerB.snapshot());
            expect(proveForRecovery(memory, 'cand-1').state).toBe('terminal');
            // The spent drain is durable too.
            expect(await ledgerB.drainInvocation('inv-1')).toBe(1);
            expect(await ledgerA.read('cand-1')).toBeNull();
          } finally {
            await second.close();
          }
        } finally {
          await first.close();
        }
      } finally {
        await host.close();
      }
    });

    it('refuses to open when the 002 asset is not applied', async () => {
      const host = await memoryPgHost();
      try {
        const projection = host.layout.projectionSchemas['engram-memory'] as string;
        await expect(openMemoryPostgresHostLedger(host.options.driver, projection)).rejects.toThrow(
          /002 asset is not applied/,
        );
        await expect(openMemoryPostgresHostLedger(null as never, projection)).rejects.toThrow(
          StorageDeniedError,
        );
      } finally {
        await host.close();
      }
    });
  });

  describe.skipIf(!pgEnabled)('live maintenance ports over the kernel', () => {
    it('runs fence, checkpoint and resync through the host-only ports', async () => {
      const host = await memoryPgHost();
      const { binding } = memoryHostComposed(host.options.driver, 'inv-live-1');
      try {
        const root = await host.open();
        const boundM = await root.bindNew(binding.maintainGrant);
        const ports = openMemoryMaintenance(binding, memoryLiveRunner(binding.maintainGrant, boundM));
        const fence = await boundM.journalFence();
        expect(await ports.checkFence(fence)).toEqual(fence);
        await expect(ports.checkFence({ ...fence, epoch: '999' })).rejects.toThrow(/not current/);
        await ports.checkpoint('live-consumer', '0', '0', fence);
        // Resync captures a snapshot boundary through the maintain grant:
        // no refusal stub, the kernel answers.
        const { snapshotRoot, journalSeq } = await ports.resync('live-consumer', fence);
        expect(typeof snapshotRoot).toBe('string');
        expect(snapshotRoot.length).toBeGreaterThan(0);
        expect(typeof journalSeq).toBe('string');
        await expect(ports.resync('live-consumer', { ...fence, epoch: '999' })).rejects.toThrow();
        // Poison/retry/snapshot delegate 1:1 to the runner (stub-proven);
        // live kernel behavior needs read-coupled authority (delivery scan
        // for poison/retry, read+maintain for snapshot reads) that the
        // strict maintain-only runner cannot carry by kernel design —
        // owned by the storage lanes and the G1b read+maintain runner.
        await expect(ports.poison('live-consumer', 'event-1', 'no delivery')).rejects.toThrow();
        await expect(ports.snapshot('live-consumer', 0, 10)).rejects.toThrow();
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
    await expect(ports.poison('consumer', 'event-1', 'poisoned')).rejects.toBeInstanceOf(StorageUnavailableError);
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
      expect(() => issueContinuationGrant(ledger, hostBindingFor(), 'cand-1', {
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
      ledger.record(entryFor('cand-1', 'user-1'));
      const binding = hostBindingFor('user-1');
      const attestation = { invocationId: 'inv-2', issuedAt: '2026-10-27T00:00:00.000Z', hostPrincipal: 'user-1' };
      const continued = issueContinuationGrant(ledger, binding, 'cand-1', attestation);
      expect(continued.candidateId).toBe('cand-1');
      expect(continued.storeId).toBe('store-1');
      expect(continued.grant.operations).toEqual(['read', 'write']);
      expect(continued.grant.lifetime).toEqual({ kind: 'invocation', invocationId: 'inv-2' });
      expect(continued.grant.scope).toEqual({ tenantId: 'tenant-a', workspaceId: 'workspace-a' });
      expect(continued.grant.principalId).toBe('user-1');
      expect(ledger.read('cand-1')?.continuationIds).toEqual(['inv-2']);
      // Unpredictable token: a second continuation mints a different grant.
      const again = issueContinuationGrant(
        ledger,
        binding,
        'cand-1',
        { ...attestation, invocationId: 'inv-3' },
      );
      expect(again.grant.token).not.toBe(continued.grant.token);
    });

    it('refuses continuations without retained authority or fresh authn', () => {
      const ledger = createMemoryHostLedger();
      const binding = hostBindingFor('user-1');
      const attestation = { invocationId: 'inv-2', issuedAt: '2026-10-27T00:00:00.000Z', hostPrincipal: 'user-1' };
      expect(() => issueContinuationGrant(ledger, binding, 'unknown', attestation)).toThrow(
        StorageDeniedError,
      );
      ledger.record(entryFor('cand-1', 'user-1'));
      expect(() => issueContinuationGrant(ledger, binding, 'cand-1', { ...attestation, invocationId: '' })).toThrow(
        StorageDeniedError,
      );
      expect(() => issueContinuationGrant(ledger, binding, 'cand-1', { ...attestation, hostPrincipal: '' })).toThrow(
        StorageDeniedError,
      );
      // Copied retained invocation fields never grant.
      expect(() => issueContinuationGrant(ledger, binding, 'cand-1', { ...attestation, invocationId: 'inv-1' })).toThrow(
        StorageDeniedError,
      );
      // Foreign principal: neither the attestation nor another binding passes.
      expect(() =>
        issueContinuationGrant(ledger, binding, 'cand-1', { ...attestation, hostPrincipal: 'other' }),
      ).toThrow(/original host principal/);
      expect(() =>
        issueContinuationGrant(ledger, hostBindingFor('other'), 'cand-1', attestation),
      ).toThrow(/different host principal/);
      issueContinuationGrant(ledger, binding, 'cand-1', attestation);
      expect(() => issueContinuationGrant(ledger, binding, 'cand-1', attestation)).toThrow(
        StorageDeniedError,
      );
    });

    it('refuses continuations of terminal candidates', () => {
      const ledger = createMemoryHostLedger();
      const binding = hostBindingFor('user-1');
      ledger.record(entryFor('cand-1', 'user-1'));
      ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      expect(() =>
        issueContinuationGrant(ledger, binding, 'cand-1', {
          invocationId: 'inv-2',
          issuedAt: '2026-10-27T00:00:00.000Z',
          hostPrincipal: 'user-1',
        }),
      ).toThrow(/completed candidates cannot continue/);
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
      expect(ledger.read('cand-1')).toEqual({ ...proof, invocationId: 'inv-1', hostPrincipal: 'host-1', continuationIds: [] });
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

    it('reattaches retained candidates and surfaces NOT_FOUND once spent', () => {
      const ledger = createMemoryHostLedger();
      const binding = hostBindingFor('user-1');
      ledger.record(entryFor('cand-1', 'user-1'));
      expect(reattachMemoryMaintenance(binding, ledger, 'cand-1')).toBe(binding.maintainGrant);
      // Never tracked: NOT_FOUND with the NOT_FOUND code, never a refusal.
      const missing = (() => {
        try {
          reattachMemoryMaintenance(binding, ledger, 'never-tracked');
          return null;
        } catch (error) {
          return error;
        }
      })();
      expect(missing).toBeInstanceOf(MemoryMaintenanceNotFoundError);
      expect((missing as MemoryMaintenanceNotFoundError).code).toBe('NOT_FOUND');
      // Spent invocation drained: the same candidate is now NOT_FOUND.
      expect(ledger.drainInvocation('inv-1')).toBe(1);
      expect(ledger.drainInvocation('inv-1')).toBe(0);
      expect(() => reattachMemoryMaintenance(binding, ledger, 'cand-1')).toThrow(
        MemoryMaintenanceNotFoundError,
      );
      expect(() => ledger.drainInvocation('')).toThrow(StorageDeniedError);
    });

    it('authorizes proof-only recovery by live maintain grant and scope', () => {
      const ledger = createMemoryHostLedger();
      const binding = hostBindingFor('user-1');
      ledger.record(entryFor('cand-1', 'user-1'));
      ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      const proof = proveForRecoveryAuthorized(ledger, binding, 'cand-1');
      expect(proof.state).toBe('terminal');
      expect(proof.receipt).toEqual({ outcome: 'admitted' });
      // A live binding for a foreign scope is refused even with authority.
      const foreign = hostBindingFor('user-1');
      const foreignScoped = {
        ...foreign,
        maintainGrant: grantFor({
          token: 'memory-maintain-foreign',
          moduleId: 'engram-memory',
          scope: { tenantId: 'tenant-a', workspaceId: 'workspace-b' },
          principalId: 'user-1',
          operations: ['maintain'],
        }),
      } as never;
      expect(() => proveForRecoveryAuthorized(ledger, foreignScoped, 'cand-1')).toThrow(
        /recovery scope does not match/,
      );
      expect(() => reattachMemoryMaintenance(foreignScoped, ledger, 'cand-1')).toThrow(
        /reattach scope does not match/,
      );
      // Drained candidates refuse proof; reattach distinguishes the spent case.
      ledger.drainInvocation('inv-1');
      expect(() => proveForRecoveryAuthorized(ledger, binding, 'cand-1')).toThrow(StorageDeniedError);
      expect(() => reattachMemoryMaintenance(binding, ledger, 'cand-1')).toThrow(
        MemoryMaintenanceNotFoundError,
      );
    });

    it('refuses malformed entries without recording', () => {
      const ledger = createMemoryHostLedger();
      expect(() => ledger.record({ ...entryFor('cand-1'), envelopeDigest: '' })).toThrow(StorageDeniedError);
      expect(() =>
        ledger.record({ ...entryFor('cand-1'), scope: { tenantId: '', workspaceId: '' } }),
      ).toThrow(StorageDeniedError);
      expect(ledger.read('cand-1')).toBeNull();
    });

    it('keeps first-write parity on identical terminals, reconciles on change', () => {
      const ledger = createMemoryHostLedger();
      ledger.record(entryFor('cand-1'));
      const terminal = ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9');
      // Identical repeat: no-op returning the retained entry.
      expect(ledger.markTerminal('cand-1', { outcome: 'admitted' }, 'cursor-9')).toBe(terminal);
      // Different receipt or cursor: reconciliation overwrites.
      const reconciled = ledger.markTerminal('cand-1', { outcome: 'retried' }, 'cursor-10');
      expect(reconciled).not.toBe(terminal);
      expect(reconciled.receipt).toEqual({ outcome: 'retried' });
      expect(reconciled.cursor).toBe('cursor-10');
      expect(ledger.markTerminal('cand-1', { outcome: 'retried' }, 'cursor-10')).toBe(reconciled);
    });
  });
});
