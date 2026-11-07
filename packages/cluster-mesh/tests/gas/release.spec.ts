import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain .mjs scripts
import { BUNDLE, MANIFEST, SBOM, SHA_FILE, buildRelease, verifyRelease } from '../../scripts/gas-release.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHA = 'a'.repeat(40);
const fresh = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gas-rel-'));
  const manifest = await buildRelease({ outDir: dir, gitSha: SHA });
  return { dir, manifest };
};

describe('G4 release assets (dry run, nothing published)', () => {
  it('builds sha256 + manifest deterministically and verify passes', async () => {
    const a = await fresh();
    const b = await fresh();
    expect(a.manifest.bundleSha256).toBe(b.manifest.bundleSha256);
    expect(readFileSync(join(a.dir, SHA_FILE), 'utf8')).toBe(`${a.manifest.bundleSha256}  ${BUNDLE}\n`);
    expect(verifyRelease(a.dir, { expectSha: a.manifest.bundleSha256 }).sha256).toBe(a.manifest.bundleSha256);
    expect(a.manifest.inputs.every((i: string) => i.startsWith('src/'))).toBe(true);
  });
  it('the git sha is part of the bundle banner and must be a real hex sha', async () => {
    const { dir } = await fresh();
    expect(readFileSync(join(dir, BUNDLE), 'utf8').split('\n')[0]).toContain(`cluster-mesh-gas`);
    expect(readFileSync(join(dir, BUNDLE), 'utf8').split('\n')[0]).toContain(SHA);
    await expect(buildRelease({ outDir: dir, gitSha: 'unknown' })).rejects.toThrow(/hex git sha/);
  });
  it('bundle sha256 = release sha256: any drift fails verify', async () => {
    const { dir, manifest } = await fresh();
    expect(() => verifyRelease(dir, { expectSha: 'b'.repeat(64) })).toThrow(/expected/);
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ ...manifest, bundleSha256: 'c'.repeat(64) }));
    expect(() => verifyRelease(dir)).toThrow(/manifest/);
    writeFileSync(join(dir, MANIFEST), JSON.stringify(manifest));
    writeFileSync(join(dir, SHA_FILE), `${'d'.repeat(64)}  ${BUNDLE}\n`);
    expect(() => verifyRelease(dir)).toThrow(/sha256/);
    writeFileSync(join(dir, SHA_FILE), `${manifest.bundleSha256}  ${BUNDLE}\n`);
    writeFileSync(join(dir, BUNDLE), `${readFileSync(join(dir, BUNDLE), 'utf8')}\n// tampered`);
    expect(() => verifyRelease(dir)).toThrow(/bundle sha256/);
  });
  it('requires a CycloneDX SBOM when asked', async () => {
    const { dir } = await fresh();
    expect(() => verifyRelease(dir, { requireSbom: true })).toThrow();
    writeFileSync(join(dir, SBOM), JSON.stringify({ bomFormat: 'SPDX' }));
    expect(() => verifyRelease(dir)).toThrow(/CycloneDX/);
    writeFileSync(join(dir, SBOM), JSON.stringify({ bomFormat: 'CycloneDX', specVersion: '1.6' }));
    expect(verifyRelease(dir, { requireSbom: true }).bytes).toBeGreaterThan(0);
  });
  it('workflow cannot publish by accident: no PR trigger, dry run default, publish gated, draft + read-back check', () => {
    const wf = readFileSync(join(HERE, '../../../../.github/workflows/cluster-mesh-gas-release.yml'), 'utf8');
    expect(wf).not.toMatch(/pull_request/);
    expect(wf).toMatch(/publish:\n\s+description:[^\n]*\n\s+type: boolean\n\s+default: false/);
    expect(wf).toMatch(/tags:\n\s+- 'cluster-mesh-gas-v\*'/);
    expect(wf.match(/gh release create/g)?.length).toBe(1);
    expect(wf).toMatch(/publish:\n\s+needs: assets\n\s+if: .*cluster-mesh-gas-v.*inputs\.publish/);
    expect(wf).toMatch(/--draft/);
    expect(wf).toMatch(/sha256sum tmp\/gas-readback/);
    expect(wf).toMatch(/verify-cluster-mesh-gas/);
  });
});
