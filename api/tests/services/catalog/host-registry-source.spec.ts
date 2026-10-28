import { describe, expect, it, vi } from 'vitest';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '@sentropic/artifacts/mcp-core';
import { createArtifactTransport } from '../../../src/services/artifacts/transport';
import { HostRegistryCatalogSource } from '../../../src/services/catalog/sources/host-registry-source';
import { CompositeCatalogRegistry } from '../../../src/services/catalog/composite-registry';
import { CatalogExecutionSeam } from '../../../src/services/catalog/execution-seam';
import { createCatalogContextResolver } from '../../../src/services/catalog/request-context';

const names = ['artifacts_ensure', 'artifacts_get', 'artifacts_list', 'artifacts_publish'];
async function fixture() {
  const transport = createArtifactTransport({ profile: compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE),
    bind: vi.fn() } as never);
  const plan = await transport.ready;
  const invoke = vi.fn(async () => ({ status: 201, body: { artifactId: 'one' } }));
  const source = new HostRegistryCatalogSource({ registry: () => plan, invoke });
  const registry = new CompositeCatalogRegistry().addSource(source);
  const seam = new CatalogExecutionSeam(registry, [source]);
  let revoked = false;
  const resolve = createCatalogContextResolver(async input => {
    if (revoked) throw new Error('revoked');
    return { tenantId: `tenant-${input.userId}`, membershipRef: 'member', consentRef: 'consent',
      policyVersion: 'v1', readOnly: false, allowedTools: input.userId === 'alice' ? names : ['artifacts_list'] };
  });
  const alice = await resolve({ kind: 'http', userId: 'alice', sessionId: 'sa', workspaceId: 'wa' });
  const bob = await resolve({ kind: 'turn', userId: 'bob', sessionId: 'sb', workspaceId: 'wb', allowedTools: names });
  return { source, registry, seam, invoke, plan, alice, bob, resolve, revoke: () => { revoked = true; } };
}

describe('authorized compiled host registry catalog source', () => {
  it('should preserve exact compiled names and schemas only in trusted authorized views', async () => {
    const { source, plan, alice } = await fixture();
    expect(source.snapshot()).toEqual([]);
    expect(source.snapshot({ ...alice })).toEqual([]);
    const entries = source.snapshot(alice);
    expect(entries.map(entry => entry.metadata.name)).toEqual(names);
    for (const entry of entries) {
      expect(entry.kind).toBe('tool');
      expect(entry.tool.inputSchema).toEqual(plan.resolveTool(entry.metadata.name)!.inputSchema);
      expect(entry).not.toHaveProperty('rawName');
    }
    expect(source.getHandler('artifacts-ensure')).toBeUndefined();
    expect(source.getHandler('artifacts_promote')).toBeUndefined();
  });

  it('should filter before ranking and serialization without caching interleaved private views', async () => {
    const { registry, source, alice, bob } = await fixture();
    for (const context of [alice, bob, bob, alice]) {
      const expected = context === alice ? names : ['artifacts_list'];
      expect(registry.list(context).map(entry => entry.metadata.name)).toEqual(expected);
      expect(source.snapshot(context).map(entry => entry.metadata.name)).toEqual(expected);
    }
    expect(registry.search('artifacts', { topK: 1 }, bob).map(hit => hit.entry.metadata.name)).toEqual(['artifacts_list']);
    expect(JSON.stringify(registry.list(bob))).not.toContain('artifacts_publish');
    expect(registry.get('artifacts_publish', bob)).toBeNull();
    expect(registry.getSources()).toEqual([]);
    expect(registry.getSources(bob).map(source => source.id)).toEqual(['host-registry']);
    const denied = await fixture().then(f => f.resolve({ kind: 'turn', userId: 'bob', sessionId: 's',
      workspaceId: 'w', allowedTools: [] }));
    expect(registry.getSources(denied)).toEqual([]);
  });

  it('should omit writes from read-only views using compiled mutability', async () => {
    const { source, resolve } = await fixture();
    const context = await resolve({ kind: 'http', userId: 'alice', sessionId: 'sa', workspaceId: 'wa', readOnly: true });
    expect(source.snapshot(context).map(entry => entry.metadata.name)).toEqual(['artifacts_get', 'artifacts_list']);
  });

  it('should isolate unequal permissions in the same tenant and workspace', async () => {
    const { source } = await fixture();
    const resolve = createCatalogContextResolver(async input => ({ tenantId: 'shared-tenant',
      membershipRef: input.userId, consentRef: 'consent', policyVersion: 'v1', readOnly: false,
      allowedTools: input.userId === 'alice' ? names : ['artifacts_get'] }));
    const context = (userId: string) => resolve({ kind: 'http', userId, sessionId: userId, workspaceId: 'shared-workspace' });
    const [alice, bob] = await Promise.all([context('alice'), context('bob')]);
    expect(source.snapshot(alice).map(entry => entry.metadata.name)).toEqual(names);
    expect(source.snapshot(bob).map(entry => entry.metadata.name)).toEqual(['artifacts_get']);
    expect(source.snapshot(alice).map(entry => entry.metadata.name)).toEqual(names);
  });

  it('should delegate one effect with refreshed authority and deny replay after revocation', async () => {
    const { seam, invoke, alice, revoke } = await fixture();
    const args = { bindingName: 'report', idempotencyKey: 'one' };
    await expect(seam.execute('artifacts_ensure', args, alice)).resolves.toEqual({
      handled: true, result: { status: 201, body: { artifactId: 'one' } } });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('artifacts_ensure', args, expect.objectContaining({
      subjectId: 'alice', tenantId: 'tenant-alice', workspaceId: 'wa', sessionId: 'sa' }));
    revoke();
    await expect(seam.execute('artifacts_ensure', args, alice)).resolves.toMatchObject({
      handled: true, result: { error: 'catalog_access_denied' } });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('should refuse forged claims, denied names and direct untrusted handler calls', async () => {
    const { source, seam, invoke, alice, bob } = await fixture();
    for (const args of [{ subjectId: 'alice' }, { workspaceId: 'wa' }, { identity: {} }]) {
      expect((await seam.execute('artifacts_ensure', args, alice)).result).toMatchObject({ error: 'catalog_access_denied' });
    }
    expect((await seam.execute('artifacts_ensure', {}, bob)).result).toMatchObject({ error: 'catalog_access_denied' });
    await expect(source.getHandler('artifacts_ensure')!({}, { ...alice })).rejects.toThrow('catalog_access_denied');
    expect(invoke).not.toHaveBeenCalled();
  });
});
