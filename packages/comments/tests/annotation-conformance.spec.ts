import { describe, expect, it } from 'vitest';

import { InMemoryCanonicalStore } from './conformance/in-memory.js';
import { runCommentsConformance } from './conformance/comments-conformance.js';
import {
  defaultDenyCapabilityCheck,
  type DecisionResolutionPort,
  type ResourceResolverPort,
} from '../src/commands.js';
import type {
  CanonicalHttpPorts,
  CanonicalHttpSurface,
  CanonicalStorageAdapterSurface,
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
  });
});
