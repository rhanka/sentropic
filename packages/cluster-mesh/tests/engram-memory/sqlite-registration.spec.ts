// G1a SQLite registration (refusal): the host registers the memory module
// shape against the installed Engram substrate with an explicitly injected
// driver. Refusal cases: engine floor, qualification shape, and the neutral
// descriptor the substrate gates construction on. Durable provider
// composition and S0 remain pending G1d/S and are not claimed here.

import { describe, expect, it } from 'vitest';
import { createMemoryPortV2, openModuleStorageCanonicalMemoryStoreV1 } from '@sentropic/engram/memory-substrate';
import {
  MEMORY_CONTRACT_DIGEST,
  MEMORY_CONTRACT_VERSION,
  MEMORY_DESCRIPTOR,
  MEMORY_PINNED_PROFILES,
  MEMORY_QUERY_NAMES,
  MEMORY_REQUIRED_PROFILES,
} from '../../src/engram-memory/manifest.js';
import {
  MEMORY_SQLITE_ENGINE_FLOOR,
  MEMORY_SQLITE_QUALIFICATION,
  checkMemorySqliteDriver,
  createMemorySqliteRegistration,
  type MemorySqliteDriverProvider,
} from '../../src/engram-memory/sqlite.js';
import {
  G1_STORE_ID,
  g1Clock,
  g1Deadline,
  g1Grant,
  g1HostHandle,
  g1ScopeBinding,
  openG1MemoryStore,
} from './g1-host.js';

const qualifiedDriver = (): MemorySqliteDriverProvider => ({
  identity: { name: 'g1-host-sqlite-owner', version: '1', artifactDigest: 'c'.repeat(64) },
  engineFloor: MEMORY_SQLITE_ENGINE_FLOOR,
});

describe('G1 SQLite registration against the installed substrate', () => {
  it('should resolve the installed memory-substrate entry points', () => {
    expect(typeof createMemoryPortV2).toBe('function');
    expect(typeof openModuleStorageCanonicalMemoryStoreV1).toBe('function');
  });

  it('should register the memory descriptor with the co-signed contract identity', async () => {
    const registration = await createMemorySqliteRegistration();
    expect(registration.descriptor.contractVersion).toBe('memory-binding-v1');
    expect(registration.descriptor.contractVersion).toBe(MEMORY_CONTRACT_VERSION);
    expect(registration.descriptor.contractDigest).toBe(MEMORY_CONTRACT_DIGEST);
    expect(registration.descriptor.contractDigest).toBe(
      'sha256:dd0cccbd6e5e29766fbc9c48351ffe58f5b0a3162152f5ff02da0798c3244fee',
    );
    expect(registration.qualification.engineFloor).toBe(MEMORY_SQLITE_ENGINE_FLOOR);
    expect(registration.qualification.journalMode).toBe('WAL');
    expect(registration.qualification.synchronous).toBe('FULL');
    expect(registration.qualification.lockingMode).toBe('EXCLUSIVE');
    expect(registration.qualification.isolation).toBe('process');
    expect(Object.keys(registration.queries)).toHaveLength(5);
    expect(registration.limits).toBeDefined();
  });

  it('should advertise every required profile with its pinned version and digest', () => {
    expect(MEMORY_REQUIRED_PROFILES).toContain('atomic-units-v1');
    const claims = new Map(MEMORY_PINNED_PROFILES.map((claim) => [claim.name, claim]));
    for (const name of MEMORY_REQUIRED_PROFILES) {
      const claim = claims.get(name);
      expect(claim, name).toBeDefined();
      expect(claim?.version).toBe('1');
      expect(claim?.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
    expect(MEMORY_QUERY_NAMES.length).toBeGreaterThan(0);
  });

  it('should pass the substrate descriptor gate with the cluster-mesh descriptor', async () => {
    // A digest or profile mismatch refuses CAPABILITY_UNAVAILABLE before any
    // fence work. Reaching the S-gated fence stage proves the co-signed
    // contract identity and every required pinned profile matched.
    const result = await openG1MemoryStore(qualifiedDriver());
    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({ operation: 'admin', retryable: false });
    expect(result.error?.code).toBe('STORE_UNAVAILABLE');
    expect(String(result.error?.message)).toContain('G1d provider seam');
  });

  it('should refuse a descriptor whose digest does not match the memory binding', async () => {
    const tampered = {
      ...g1HostHandle(),
      descriptor: { ...MEMORY_DESCRIPTOR, contractDigest: 'sha256:0'.padEnd(71, '0') },
    } as never;
    const result = (await openModuleStorageCanonicalMemoryStoreV1({
      handle: tampered,
      scope_binding: g1ScopeBinding(),
      grant: g1Grant(),
      clock: g1Clock(),
      deadline_at: g1Deadline(),
    })) as unknown as { ok: boolean; error?: { code?: unknown; message?: unknown } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(String(result.error?.message)).toContain('descriptor digest does not match');
  });

  it('should refuse a handle bound to another module', async () => {
    const result = await openG1MemoryStore(qualifiedDriver(), {
      handle: { ...g1HostHandle(), moduleId: 'other-module' } as never,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('CAPABILITY_UNAVAILABLE');
    expect(String(result.error?.message)).toContain('bound to another module');
  });

  it('should keep the store identity stable across the composition', () => {
    expect(G1_STORE_ID).toBe('g1-qualification-canonical-store-01');
    expect(checkMemorySqliteDriver(qualifiedDriver()).engineFloor).toBe(MEMORY_SQLITE_ENGINE_FLOOR);
  });
});
