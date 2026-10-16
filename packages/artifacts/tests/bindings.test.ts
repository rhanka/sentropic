/**
 * L-5a — provider definitions and owner-scoped stable bindings.
 *
 * A provider definition maps exact public names to internal
 * (providerId, capability) pairs; duplicate public names are rejected at
 * definition time and across providers before activation. A logical binding
 * (owner + scope + name) resolves to one server-allocated UUID no matter
 * which client ensures it first; another owner resolves nothing, and
 * concurrent ensures converge on a single identity.
 */
import { describe, expect, it } from 'vitest';
import {
  assertNoPublicNameCollisions,
  defineProvider,
  publicNameMap,
} from '../src/provider-definition.js';
import { createBindingService, createMemoryBindingKv } from '../src/server/bindings.js';
import { defineParameters } from '../src/parameters.js';

const PARAMS = defineParameters([{ key: 'title', type: 'string', required: true }]);

function makeProvider(id: string, tools: string[]) {
  return defineProvider({
    providerId: id,
    version: '1.0.0',
    parameters: PARAMS,
    capabilities: tools.map((name) => ({ kind: 'tool', name, publicName: `${id}_${name}` })),
  });
}

describe('provider definitions', () => {
  it('maps exact public names to internal pairs', () => {
    const def = makeProvider('pages', ['ensure', 'publish']);
    const map = publicNameMap(def);
    expect(map.get('pages_ensure')).toEqual({ providerId: 'pages', capabilityName: 'ensure' });
    expect(map.get('pages_publish')).toEqual({ providerId: 'pages', capabilityName: 'publish' });
    expect(map.size).toBe(2);
  });

  it('rejects duplicate public names at definition time', () => {
    expect(() =>
      defineProvider({
        providerId: 'pages',
        version: '1.0.0',
        parameters: PARAMS,
        capabilities: [
          { kind: 'tool', name: 'a', publicName: 'same' },
          { kind: 'tool', name: 'b', publicName: 'same' },
        ],
      }),
    ).toThrow(/duplicate publicName/);
    expect(() => defineProvider({ providerId: '', version: '1.0.0', parameters: PARAMS, capabilities: [] })).toThrow(
      /providerId/,
    );
  });

  it('rejects cross-provider public-name collisions before activation', () => {
    const a = makeProvider('one', ['ensure']);
    const colliding = defineProvider({
      providerId: 'two',
      version: '1.0.0',
      parameters: PARAMS,
      capabilities: [{ kind: 'tool', name: 'other', publicName: 'one_ensure' }],
    });
    expect(() => assertNoPublicNameCollisions([a, colliding])).toThrow(/one_ensure/);
    expect(() => assertNoPublicNameCollisions([a, makeProvider('two', ['ensure'])])).not.toThrow();
  });
});

describe('stable bindings', () => {
  it('resolves the same server UUID from two fresh clients', async () => {
    const kv = createMemoryBindingKv();
    const first = createBindingService(kv);
    const second = createBindingService(kv);
    const a = await first.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-1', bindingName: 'site' });
    const b = await second.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-1', bindingName: 'site' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.artifactId).toBe(a.artifactId);
    expect(await first.find({ ownerId: 'owner-1', bindingName: 'site' })).toBe(a.artifactId);
  });

  it('isolates bindings by owner: guessing resolves nothing', async () => {
    const kv = createMemoryBindingKv();
    const service = createBindingService(kv);
    const mine = await service.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-1', bindingName: 'site' });
    const theirs = await service.ensure({ ownerId: 'owner-2', storageScopeId: 'scope-1', bindingName: 'site' });
    expect(theirs.artifactId).not.toBe(mine.artifactId);
    expect(await service.find({ ownerId: 'owner-2', bindingName: 'site' })).toBe(theirs.artifactId);
    expect(await service.find({ ownerId: 'owner-3', bindingName: 'site' })).toBeUndefined();
  });

  it('fails closed on a conflicting storage scope', async () => {
    const kv = createMemoryBindingKv();
    const service = createBindingService(kv);
    await service.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-1', bindingName: 'site' });
    await expect(
      service.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-2', bindingName: 'site' }),
    ).rejects.toThrow(/scope mismatch/);
  });

  it('converges concurrent ensures on a single identity', async () => {
    const kv = createMemoryBindingKv();
    const service = createBindingService(kv);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        Promise.resolve().then(() =>
          service.ensure({ ownerId: 'owner-1', storageScopeId: 'scope-1', bindingName: 'race' }),
        ),
      ),
    );
    const ids = new Set(results.map((r) => r.artifactId));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.created).length).toBe(1);
  });
});
