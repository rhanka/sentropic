import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalStore } from './conformance/in-memory.js';
import { runCommentsConformance, conformanceCapacity } from './conformance/comments-conformance.js';
import {
  defaultDenyCapabilityCheck,
  type DecisionResolutionPort,
  type ResourceResolverPort,
} from '../src/commands.js';
import {
  CANONICAL_READ_PAGE_OUTCOMES,
  CANONICAL_WIRE_ERROR_CODES,
  type CanonicalHttpPorts,
  type CanonicalHttpSurface,
  type CanonicalRouterFactory,
  type CanonicalStorageAdapterSurface,
} from '../src/command-store.js';

describe('canonical comments conformance', () => {
  it('passes the full corpus against the in-memory store', async () => {
    await runCommentsConformance(new InMemoryCanonicalStore());
  });

  it('keeps every corpus case isolated per store instance', async () => {
    await runCommentsConformance(new InMemoryCanonicalStore());
    await runCommentsConformance(new InMemoryCanonicalStore());
  });

  it('declares the storage and HTTP surfaces without placement literals', () => {
    const store = new InMemoryCanonicalStore();
    const resolver: ResourceResolverPort = { resolve: async () => 'exact' };
    const decisions: DecisionResolutionPort = { resolve: async () => null };
    const ports: CanonicalHttpPorts = {
      store,
      capabilities: defaultDenyCapabilityCheck,
      resolver,
      decisions,
    };
    const storage: CanonicalStorageAdapterSurface = {
      port: store,
      basis: 'generic-cluster-mesh-storage-port',
      dependencies: 'injected-connection-clock-ids',
      status: 'due-m2',
    };
    const http: CanonicalHttpSurface = {
      entrypoint: 'createCanonicalCommentsRouter',
      factorySignature: 'CanonicalRouterFactory',
      ports,
      status: 'due-m3',
    };
    expect(storage.port).toBe(store);
    expect(http.ports.store).toBe(store);
    const serialized = `${storage.basis} ${storage.dependencies} ${storage.status} ${http.entrypoint} ${http.factorySignature} ${http.status}`;
    expect(serialized).not.toMatch(/(\.\/|packages\/|src\/|migrations)/);

    const factory: CanonicalRouterFactory<{ composed: boolean }> = (_ports, options) => {
      expect(options.capacity.batchUnits.limit).toBeGreaterThan(0);
      return { composed: true };
    };
    expect(factory(ports, { capacity: conformanceCapacity() })).toEqual({ composed: true });
  });

  it('closes the wire error vocabulary', () => {
    expect([...CANONICAL_WIRE_ERROR_CODES]).toEqual([
      'unauthenticated',
      'denied',
      'not-found',
      'conflict',
      'invalid-request',
      'capacity-exceeded',
      'incomplete',
    ]);
  });

  it('closes the read-page outcome vocabulary', () => {
    expect([...CANONICAL_READ_PAGE_OUTCOMES]).toEqual(['page', 'incomplete', 'inaccessible']);
  });
});
