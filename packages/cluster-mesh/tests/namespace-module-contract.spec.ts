import { describe, expect, it, vi } from 'vitest';
import {
  CLUSTER_MESH_NAMESPACES,
  type ClusterMeshNamespaceModule,
  type VerifiedInvocationContextPort,
} from '../../contracts/src/index.js';
import type { InvocationReceiptPort } from '../../events/src/index.js';

describe('cluster mesh namespace module contract', () => {
  it('should expose exactly 29 unique provider-neutral namespace keys', () => {
    expect(CLUSTER_MESH_NAMESPACES).toHaveLength(29);
    expect(new Set(CLUSTER_MESH_NAMESPACES).size).toBe(29);
  });

  it('should construct a module with synthetic injected ports', () => {
    const context: VerifiedInvocationContextPort = {
      async verify(input) {
        return {
          ...input,
          principal: {
            principalId: 'workload-1',
            kind: 'workload',
            verifierId: 'verifier-1',
          },
          workspace: {
            bindingId: 'binding-1',
            workspaceId: 'workspace-1',
            revision: 'revision-1',
          },
          scopes: [],
          policyRevision: 'policy-1',
          issuedAt: '2026-08-30T12:00:00.000Z',
        };
      },
    };
    const receipts: InvocationReceiptPort = { append: vi.fn(async () => undefined) };
    const module: ClusterMeshNamespaceModule<
      { readonly mount: string },
      VerifiedInvocationContextPort,
      InvocationReceiptPort
    > = {
      namespace: '/session',
      enabled: true,
      createRouter: () => ({ mount: '/session' }),
    };

    expect(module.createRouter({ context, receipts })).toEqual({ mount: '/session' });
  });
});
