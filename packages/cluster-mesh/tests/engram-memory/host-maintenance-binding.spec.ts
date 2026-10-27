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
import { assembleMemoryHostBinding, issueContinuationGrant } from '../../src/engram-memory/binding.js';
import { openMemoryMaintenance } from '../../src/engram-memory/host-maintenance.js';
import { createMemoryHostLedger, proveForRecovery } from '../../src/engram-memory/ledger.js';
import { MemoryHostDriverRequiredError } from '../../src/engram-memory/sqlite.js';
import { StorageDeniedError, StorageUnavailableError } from '../../src/storage/errors.js';
import { grantFor } from '../storage/authority-corpus.js';
import { g1Grant } from './g1-host.js';

const qualifiedProvider = () => ({
  identity: { name: 'node-pg-owner', version: '8.16.3', artifactDigest: 'b'.repeat(64) },
  serverFloor: '17.0.0',
});

const maintainGrant = () =>
  grantFor({
    token: 'memory-maintain-1',
    moduleId: 'engram-memory',
    scope: { tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    operations: ['maintain'],
  });

describe('host maintenance binding', () => {
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
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant() });
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
      }),
    ).toThrow(StorageDeniedError);
    expect(() =>
      assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: null }),
    ).toThrow(StorageDeniedError);
  });

  it('opens host-only ports from the binding and fails closed until G1b', async () => {
    const binding = assembleMemoryHostBinding({ driver: qualifiedProvider(), maintainGrant: maintainGrant() });
    const ports = openMemoryMaintenance(binding);
    await expect(ports.checkFence('lane', '1')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.checkpoint('consumer', 'cursor')).rejects.toThrow(/G1b stateful projection/);
    await expect(ports.poison('consumer', 'reason')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.resync('scope')).rejects.toBeInstanceOf(StorageUnavailableError);
    await expect(ports.snapshot('scope')).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(() => openMemoryMaintenance(null as never)).toThrow(StorageDeniedError);
  });
  it('denies maintenance operations through the neutral memory handle', () => {
    const provider = qualifiedProvider();
    // The neutral handle grant carries only read/write: it cannot assemble
    // a binding and cannot open maintenance ports.
    expect(() =>
      assembleMemoryHostBinding({ driver: provider, maintainGrant: g1Grant() }),
    ).toThrow(StorageDeniedError);
    expect(() =>
      openMemoryMaintenance({ provider, maintainGrant: g1Grant() } as never),
    ).toThrow(StorageDeniedError);
  });
  it.todo('refuses expired, revoked or foreign-scope maintain grants');
  it.todo('checks fences and checkpoints through the host-only binding');
  it.todo('retries and poisons consumers without a second effect');
  it.todo('resyncs scope-chain-index and snapshots through maintenance ports');
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
  it.todo('recovers proof-only: authorized capture-proof reads, no second effect');
});
