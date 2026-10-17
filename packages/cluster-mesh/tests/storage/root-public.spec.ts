import { describe, expect, it } from 'vitest';
import { createStagedKernel } from '../../src/storage/index.js';
import { grantFor } from './authority-corpus.js';

describe('public staged storage ports', () => {
  it('should keep issuance, registries and mutation state unreachable from adapters', () => {
    const root = createStagedKernel({ moduleId: 'comments' });
    const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
    const bound = root.bindNew(grant);
    const adapter = root.adapter();
    expect(Object.keys(adapter).sort()).toEqual(['bind', 'incarnation', 'moduleId']);
    for (const name of ['core', 'inner', 'ctx', 'staged', 'projections', 'sealStaged', 'armExternalFailure']) expect((bound as unknown as Record<string, unknown>)[name]).toBeUndefined();
    expect(Object.isFrozen(bound)).toBe(true);
    expect(Object.isFrozen(Object.getPrototypeOf(bound))).toBe(true);
    for (const claim of bound.profiles) {
      expect(claim.digest).toMatch(/^[0-9a-f]{64}$/);
      const capability = bound.capability(claim.profile);
      expect(Object.values(capability.port).some((value) => typeof value === 'function')).toBe(true);
      expect(Object.isFrozen(capability.port)).toBe(true);
    }
    expect(() => bound.capability('generations-v1')).toThrow();
    root.revoke(grant.token);
    expect(() => bound.capability('staged-units-v1')).toThrow();
  });

  it('should relay authority pins and preserve revocation across backend recreation', async () => {
    let allowed = true;
    const root = createStagedKernel({ moduleId: 'comments', authority: { attest: () => { if (!allowed) throw new Error('host denied'); } } });
    const bound = root.bindNew(grantFor());
    allowed = false;
    await expect(bound.readHead('x')).rejects.toThrow('host denied');
  });
});
