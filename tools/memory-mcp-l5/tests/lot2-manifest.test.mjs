import { expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex, sha512Integrity, PINNED_IMAGE_DIGEST } from '../schema-validator.mjs';
import { validateLot2Manifest, P3_SHA256 } from '../lot2-manifest.mjs';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'l5-manifest-'));
  const ref = (path, bytes) => { writeFileSync(join(root, path), bytes); return { path, sha256: sha256Hex(bytes) }; };
  const archive = (name, version) => {
    const stage = join(root, name.split('/').pop()); mkdirSync(join(stage, 'package'), { recursive: true });
    writeFileSync(join(stage, 'package/package.json'), JSON.stringify({ name, version }));
    const bytes = execFileSync('tar', ['--format=ustar', '-czf', '-', '-C', stage, 'package/package.json']);
    return { ...ref(name.split('/').pop() + '.tgz', bytes), name, version, integrity: sha512Integrity(bytes) };
  };
  const e2 = archive('@sentropic/engram', '0.21.2'), backend = archive('@sentropic/cluster-mesh', '0.22.4');
  const preCandidate = ref('p3.json', readFileSync('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
  const closure = [e2, backend];
  const lock = ref('lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { dependencies: Object.fromEntries(closure.map(x => [x.name, x.version])) },
    ...Object.fromEntries(closure.map(x => [`node_modules/${x.name}`, { version: x.version, integrity: x.integrity, resolved: 'https://registry.npmjs.org/' + x.name }])) } }));
  const evidence = ref('receipt.json', JSON.stringify({ status: 'unverified' }));
  const manifest = { manifestVersion: 1, stage: 'lot2', status: 'unverified', preCandidate, e2, backend,
    neutralDeclarations: evidence, hostProfile: evidence, lock, closure,
    runtime: { imageDigest: PINNED_IMAGE_DIGEST, nodeVersion: '24.16.0', sqliteVersion: '3.50.0', python: false, nativeAddonCompilation: false },
    acknowledgements: { g1: evidence, g2: evidence, g3: evidence, g4: evidence, c9: evidence } };
  return { root, manifest };
}
it('should bind immutable P3 and refuse fixture acceptance even with matching digests', () => {
  const { root, manifest } = fixture();
  try {
    expect(manifest.preCandidate.sha256).toBe(P3_SHA256);
    expect(validateLot2Manifest(manifest, root)).toContain('manifest: unverified');
    for (const mutate of [m => { m.preCandidate.sha256 = '0'.repeat(64); }, m => { m.e2.version = '0.22.0'; },
      m => { m.e2.sha256 = '0'.repeat(64); }, m => { delete m.backend; }, m => { m.closure = []; },
      m => { m.lock.path = '../escape'; }, m => { m.runtime.python = true; }, m => { m.extra = true; }]) {
      const changed = structuredClone(manifest); mutate(changed);
      expect(validateLot2Manifest(changed, root).length).toBeGreaterThan(validateLot2Manifest(manifest, root).length);
    }
    writeFileSync(join(root, manifest.e2.path), 'tampered');
    expect(validateLot2Manifest(manifest, root).join('\n')).toContain('sha256');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
