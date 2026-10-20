import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { encodeCompoundKey } from '../../src/storage/contracts.js';
import { buildManifest, canonicalManifestEncoding, digestManifest, ManifestRegistry, type ExportManifest } from '../../src/storage/manifest.js';

const common = { scope: { tenantId: 't', workspaceId: 'w' }, descriptorVersion: 'd', encodingVersion: 'e', terminal: { count: '0', complete: false } };
const distinguish = (encode: (manifest: ExportManifest) => string) => {
  const one = buildManifest({ ...common, selections: ['a'], heads: { a: { head: 'h1', allocation: '1' } }, unitRoots: ['b', 'h2', '1'] });
  const two = buildManifest({ ...common, selections: ['a', 'b'], heads: { a: { head: 'h1', allocation: '1' }, b: { head: 'h2', allocation: '1' } }, unitRoots: [] });
  assert.notEqual(encode(one), encode(two), 'C17: framed selections cannot collide with unit roots');
};
const buildOwnership = (build: typeof buildManifest) => {
  const heads = { a: { head: 'original', allocation: '1' } };
  const manifest = build({ ...common, selections: ['a'], heads, unitRoots: [] });
  heads.a.head = 'changed';
  assert.equal(manifest.heads.a.head, 'original', 'C17: manifest building owns nested heads');
};
const retainedOwnership = (registry: Pick<ManifestRegistry, 'retain' | 'verify'>) => {
  const manifest = buildManifest({ ...common, selections: ['a'], heads: { a: { head: 'original', allocation: '1' } }, unitRoots: [] });
  const digest = registry.retain(manifest);
  (manifest.heads.a as { head: string }).head = 'changed caller value';
  assert.equal(registry.verify(digest).heads.a.head, 'original', 'C17: retained heads own caller values');
  try { (registry.verify(digest).heads.a as { head: string }).head = 'changed return value'; } catch { /* immutable value */ }
  assert.equal(registry.verify(digest).heads.a.head, 'original', 'C17: returned heads cannot change retained boundaries');
};
class AliasedRegistry {
  private stored!: ExportManifest;
  constructor(private readonly ownInput: boolean) {}
  retain(manifest: ExportManifest): string {
    this.stored = this.ownInput ? JSON.parse(JSON.stringify(manifest)) as ExportManifest : { ...manifest, heads: { ...manifest.heads } };
    return digestManifest(manifest);
  }
  verify(_digest: string): ExportManifest { return this.stored; }
}

describe('manifest integrity qualification and exact-target mutations', () => {
  it('should qualify framing and both ownership boundaries', () => {
    distinguish(canonicalManifestEncoding); buildOwnership(buildManifest); retainedOwnership(new ManifestRegistry());
  });
  it('should kill the original collection-flattening encoding', () => {
    const flatten = (manifest: ExportManifest) => encodeCompoundKey([manifest.version, manifest.scope.tenantId, manifest.scope.workspaceId,
      ...manifest.selections.flatMap((key) => [key, manifest.heads[key].head, manifest.heads[key].allocation]), ...manifest.unitRoots,
      manifest.descriptorVersion, manifest.encodingVersion, manifest.terminal.count, manifest.terminal.complete ? 'complete' : 'partial',
    ]);
    assert.throws(() => distinguish(flatten), /C17: framed selections cannot collide with unit roots/);
  });
  it('should kill shallow manifest building at the caller-head assertion', () => {
    const shallow: typeof buildManifest = (input) => ({ ...buildManifest(input), heads: { ...input.heads } });
    assert.throws(() => buildOwnership(shallow), /C17: manifest building owns nested heads/);
  });
  it('should kill shallow retention at the caller-value assertion', () => {
    assert.throws(() => retainedOwnership(new AliasedRegistry(false)), /C17: retained heads own caller values/);
  });
  it('should kill mutable returned heads at the returned-value assertion', () => {
    assert.throws(() => retainedOwnership(new AliasedRegistry(true)), /C17: returned heads cannot change retained boundaries/);
  });
});
