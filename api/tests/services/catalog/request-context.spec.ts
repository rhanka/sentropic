import { describe, expect, it, vi } from 'vitest';
import {
  createCatalogContextResolver, isTrustedCatalogContext, revalidateCatalogInvocation,
} from '../../../src/services/catalog/request-context';

function fixture() {
  const authority = vi.fn(async () => ({
    tenantId: 'tenant-a', membershipRef: 'member:editor', consentRef: 'first-party:session-a',
    policyVersion: 'v1', readOnly: false, allowedTools: ['artifacts_get', 'artifacts_publish'],
  }));
  const resolve = createCatalogContextResolver(authority);
  const input = { kind: 'http' as const, userId: 'alice', sessionId: 'session-a', workspaceId: 'workspace-a' };
  return { authority, resolve, input };
}

describe('trusted catalog context', () => {
  it('should freeze identity and the copied allowlist when resolving server inputs', async () => {
    const { resolve, input } = fixture();
    const context = await resolve(input);
    input.userId = 'mallory';
    expect(context.subjectId).toBe('alice');
    expect(Object.isFrozen(context)).toBe(true);
    expect(Object.isFrozen(context.allowedTools)).toBe(true);
    expect(isTrustedCatalogContext(context)).toBe(true);
    expect(isTrustedCatalogContext({ ...context })).toBe(false);
  });

  it('should intersect live grants with the server turn allowlist and read-only policy', async () => {
    const { resolve, input } = fixture();
    const context = await resolve({ ...input, kind: 'turn', readOnly: true, allowedTools: ['artifacts_get'] });
    expect(context.allowedTools).toEqual(['artifacts_get']);
    await expect(revalidateCatalogInvocation(context, 'artifacts_publish', {})).rejects.toThrow('catalog_access_denied');
    expect(context.readOnly).toBe(true);
    expect(context.sessionKind).toBe('turn');
    const readOnly = await resolve({ ...input, readOnly: true });
    await expect(revalidateCatalogInvocation(readOnly, 'artifacts_publish', {}, true)).rejects.toThrow('catalog_access_denied');
  });

  it('should deny forged contexts and identity claims before invoking anything', async () => {
    const { resolve, input } = fixture();
    const context = await resolve(input);
    await expect(revalidateCatalogInvocation({ ...context }, 'artifacts_get', {})).rejects.toThrow('catalog_access_denied');
    for (const key of ['subjectId', 'sessionId', 'tenantId', 'workspaceId', 'clientId', 'identity', 'context']) {
      await expect(revalidateCatalogInvocation(context, 'artifacts_get', { [key]: 'forged' }))
        .rejects.toThrow('catalog_access_denied');
    }
    await expect(revalidateCatalogInvocation(context, 'artifacts_get', { artifactId: 'resource-selector' }))
      .resolves.toMatchObject({ subjectId: 'alice' });
  });

  it('should reject changed tenant or policy and revoked authority after discovery', async () => {
    const { resolve, input, authority } = fixture();
    const context = await resolve(input);
    authority.mockResolvedValueOnce({ ...(await authority()), tenantId: 'tenant-b' });
    await expect(revalidateCatalogInvocation(context, 'artifacts_get', {})).rejects.toThrow('catalog_access_denied');
    authority.mockResolvedValueOnce({ ...(await authority()), policyVersion: 'v2' });
    await expect(revalidateCatalogInvocation(context, 'artifacts_get', {})).rejects.toThrow('catalog_access_denied');
    authority.mockRejectedValueOnce(new Error('revoked'));
    await expect(revalidateCatalogInvocation(context, 'artifacts_get', {})).rejects.toThrow('catalog_access_denied');
  });
});
