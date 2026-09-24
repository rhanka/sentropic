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
  it.each([undefined, 1001])('should accept legacy or unexpired references (%s)', async expiresAt => {
    const ref = { ...reference, ...(expiresAt === undefined ? {} : { expiresAt }) };
    const local = { create: vi.fn(async () => ref), verify: vi.fn(async () => true), resolve: vi.fn(async () => 'identity') };
    const domain = createLocalProjectionDomain({ homeNodeId: ref.homeNodeId, local, now: () => 1000 });
    await expect(domain.project('agent_identity', 'agent')).resolves.toBe(ref);
    await expect(domain.resolve(ref)).resolves.toBe('identity');
    expect(local.verify).toHaveBeenCalledWith(ref);
  });

  it.each([999, 1000, NaN, Infinity, 1000.5, '2000', null])('should reject expired or malformed expiry on both paths (%s)', async expiresAt => {
    const ref = { ...reference, expiresAt } as SignedProjectionReference;
    const local = { create: vi.fn(async () => ref), verify: vi.fn(async () => true), resolve: vi.fn() };
    const domain = createLocalProjectionDomain({ homeNodeId: ref.homeNodeId, local, now: () => 1000 });
    await expect(domain.project('agent_identity', 'agent')).rejects.toMatchObject({ code: 'invalid_projection_reference' });
    await expect(domain.resolve(ref)).rejects.toMatchObject({ code: 'invalid_projection_reference' });
    expect(local.resolve).not.toHaveBeenCalled();
  });

  it('should check expiry after verification and reject a tampered future expiry', async () => {
    let now = 1000;
    const ref = { ...reference, expiresAt: 1001 };
    const local = { create: vi.fn(async () => ref), verify: vi.fn(async () => { now = 1001; return true; }), resolve: vi.fn() };
    const domain = createLocalProjectionDomain({ homeNodeId: ref.homeNodeId, local, now: () => now });
    await expect(domain.resolve(ref)).rejects.toThrow();
    local.verify.mockResolvedValue(false);
    await expect(domain.resolve({ ...ref, expiresAt: 9999 })).rejects.toThrow();
    await expect(domain.project('agent_identity', 'agent')).rejects.toThrow();
    expect(local.resolve).not.toHaveBeenCalled();
  });

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
