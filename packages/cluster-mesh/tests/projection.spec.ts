import { describe, expect, it, vi } from 'vitest';
import { createLocalProjectionDomain, type SignedProjectionReference } from '../src/index.js';

const reference: SignedProjectionReference = {
  kind: 'agent_identity',
  reference: 'agent:local-1',
  homeNodeId: 'node:sentropic-local',
  issuer: 'https://auth.example.test',
  keyId: 'key-1',
  signature: 'opaque-signature',
};

describe('W-A local projection', () => {
  it('should resolve a verified signed reference on its home node', async () => {
    const local = {
      create: vi.fn(async () => reference),
      verify: vi.fn(async () => true),
      resolve: vi.fn(async () => ({ h2aRef: 'nhi:agent-1' })),
    };
    const projection = createLocalProjectionDomain({ homeNodeId: reference.homeNodeId, local });

    await expect(projection.resolve(reference)).resolves.toEqual({ h2aRef: 'nhi:agent-1' });
    expect(local.verify).toHaveBeenCalledWith(reference);
  });

  it('should reject an invalid local signed reference', async () => {
    const projection = createLocalProjectionDomain({
      homeNodeId: reference.homeNodeId,
      local: {
        async create() { return reference; },
        async verify() { return false; },
        async resolve() { return {}; },
      },
    });

    await expect(projection.resolve(reference)).rejects.toMatchObject({
      code: 'invalid_projection_reference',
    });
  });

  it('should fail closed before resolving a reference owned by another server', async () => {
    const resolve = vi.fn(async () => ({}));
    const projection = createLocalProjectionDomain({
      homeNodeId: reference.homeNodeId,
      local: { async create() { return reference; }, async verify() { return true; }, resolve },
    });

    await expect(projection.resolve({ ...reference, homeNodeId: 'node:remote' })).rejects.toMatchObject({
      capability: 'remote_projection',
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
