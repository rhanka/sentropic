import { describe, expect, it } from 'vitest';
import type { ClusterMeshNamespaceModule } from '../../contracts/src/index.js';
import {
  createNamespaceRegistry,
  NamespaceRegistrationError,
} from '../src/runtime/namespace-registry.js';

const module = (
  namespace: '/health' | '/admin',
  enabled: boolean,
): ClusterMeshNamespaceModule<string, string, string> => ({
  namespace,
  enabled,
  createRouter: () => namespace,
});

describe('namespace registry', () => {
  it('should retain disabled modules without mounting them as enabled', () => {
    const registry = createNamespaceRegistry([
      module('/health', true),
      module('/admin', false),
    ]);

    expect(registry.list()).toHaveLength(2);
    expect(registry.enabled().map((entry) => entry.namespace)).toEqual(['/health']);
    expect(registry.get('/admin')?.enabled).toBe(false);
  });

  it('should reject duplicate namespace authors', () => {
    expect(() => createNamespaceRegistry([
      module('/health', true),
      module('/health', false),
    ])).toThrow(NamespaceRegistrationError);
  });
});
