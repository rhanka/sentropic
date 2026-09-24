import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalProjectionReferenceBytes, createLocalProjectionDomain, type SignedProjectionReference } from '../src/index.js';

const reference: SignedProjectionReference = {
  kind: 'agent_identity',
  reference: 'agent:local-1',
  homeNodeId: 'node:sentropic-local',
  issuer: 'https://auth.example.test',
  keyId: 'key-1',
  signature: 'opaque-signature',
};

describe('W-A local projection', () => {
  it.each([
    [{}, 1000], [{ expiresAt: 1100 }, NaN], [{ expiresAt: 1100 }, Infinity],
    [{ expiresAt: 1201 }, 1000], [{ issuedAt: 900, expiresAt: 1101 }, 1000],
    [{ issuedAt: 1001, expiresAt: 1100 }, 1000],
    [{ issuedAt: NaN, expiresAt: 1100 }, 1000],
  ])('should fail closed with an expiry-ignorant verifier (%j, %s)', async (timestamps, now) => {
    const ref = { ...reference, ...timestamps };
    const local = { create: vi.fn(async () => ref), verify: vi.fn(async () => true), resolve: vi.fn() };
    const domain = createLocalProjectionDomain({
      homeNodeId: ref.homeNodeId, local, now: () => now, requireExpiry: true, maxTtlMs: 200,
    });
    await expect(domain.project(ref.kind, 'agent')).rejects.toMatchObject({ code: 'invalid_projection_reference' });
    await expect(domain.resolve(ref)).rejects.toMatchObject({ code: 'invalid_projection_reference' });
    expect(local.resolve).not.toHaveBeenCalled();
  });

  it('should accept bounded timestamps and apply explicit skew at the boundary', async () => {
    const ref = { ...reference, issuedAt: 900, expiresAt: 1100 };
    const local = { create: vi.fn(async () => ref), verify: vi.fn(async () => true), resolve: vi.fn(async () => 'ok') };
    let now = 1100;
    const domain = createLocalProjectionDomain({
      homeNodeId: ref.homeNodeId, local, now: () => now, requireExpiry: true, maxTtlMs: 200, clockSkewMs: 5,
    });
    await expect(domain.project(ref.kind, 'agent')).resolves.toBe(ref);
    await expect(domain.resolve(ref)).resolves.toBe('ok');
    now = 1105;
    await expect(domain.resolve(ref)).rejects.toMatchObject({ code: 'invalid_projection_reference' });
  });

  it('should authenticate both timestamps with real Ed25519 signatures', async () => {
    const keys = generateKeyPairSync('ed25519');
    const ref = { ...reference, issuedAt: 900, expiresAt: 1100 };
    ref.signature = sign(null, canonicalProjectionReferenceBytes(ref), keys.privateKey).toString('base64');
    const local = {
      create: vi.fn(async () => ref), resolve: vi.fn(async () => 'ok'),
      verify: async (value: SignedProjectionReference) => verify(null,
        canonicalProjectionReferenceBytes(value), keys.publicKey, Buffer.from(value.signature, 'base64')),
    };
    const domain = createLocalProjectionDomain({ homeNodeId: ref.homeNodeId, local, now: () => 1000, requireExpiry: true });
    await expect(domain.resolve(ref)).resolves.toBe('ok');
    for (const tampered of [{ ...ref, expiresAt: 9999 }, { ...ref, expiresAt: undefined },
      { ...ref, issuedAt: 901 }, { ...ref, issuedAt: undefined }]) {
      expect(await local.verify(tampered)).toBe(false);
      local.create.mockResolvedValue(tampered as typeof ref);
      await expect(domain.project(ref.kind, 'agent')).rejects.toMatchObject({ code: 'invalid_projection_reference' });
      await expect(domain.resolve(tampered)).rejects.toMatchObject({ code: 'invalid_projection_reference' });
    }
    expect(local.resolve).toHaveBeenCalledOnce();
  });

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
