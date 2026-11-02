import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantBoundaryError } from '@sentropic/cluster-mesh';
import { CmTenantResolutionError, reconcileCmTenantId, resolveCmTenant } from '../../../src/services/identity/cm-tenancy';

const resolve = vi.hoisted(() => vi.fn());
vi.mock('../../../src/services/identity/cm-identity', () => ({
  getCmIdentity: () => ({ resolver: { resolveAuthoritatively: resolve } }),
}));
vi.mock('../../../src/services/identity/cm-transaction', () => ({
  runCmIdentityRead: (operation: () => Promise<unknown>) => operation(),
}));
const lookup = { workspaceId: 'workspace', userId: 'user' };

describe('CM tenant refusal translation', () => {
  beforeEach(() => vi.resetAllMocks());
  it('keeps an actual boundary refusal opaque', async () => {
    resolve.mockRejectedValue(new TenantBoundaryError());
    expect(await resolveCmTenant(lookup)).toEqual({ error: 'unknown' });
    await expect(reconcileCmTenantId({ ...lookup, path: 'test' })).rejects.toBeInstanceOf(CmTenantResolutionError);
  });
  it('propagates infrastructure and private retry failures without classifying a denial', async () => {
    for (const failure of [new Error('database unavailable'), Object.freeze({ privateRetry: true })]) {
      resolve.mockRejectedValue(failure);
      await expect(resolveCmTenant(lookup)).rejects.toBe(failure);
      await expect(reconcileCmTenantId({ ...lookup, path: 'test' })).rejects.toBe(failure);
    }
  });
});
