import { afterEach, expect, it } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { assembleCandidate, verifyCandidateArchive, writeImmutable } from '../candidate.mjs';
import { ANCILLARY, sha256, integrity } from '../precandidate.mjs';
import { P1_CONFIG_FILES, TOOLCHAIN_SNAPSHOT_FILES } from '../build-inputs.mjs';
const prePath = 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', head = 'a'.repeat(40), dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'l5-candidate-')); dirs.push(root);
  const pre = JSON.parse(readFileSync(prePath));
  for (const path of new Set([prePath, prePath + '.sha256', 'Makefile', 'package-lock.json', ...ANCILLARY,
    ...P1_CONFIG_FILES, ...TOOLCHAIN_SNAPSHOT_FILES, pre.source.declaredLockSnapshot.path, ...pre.artifacts.map(a => a.archive)])) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); cpSync(path, join(root, path));
  }
  const artifact = (name, role) => {
    const stage = join(root, role), archive = role + '.tgz'; mkdirSync(join(stage, 'package'), { recursive: true });
    writeFileSync(join(stage, 'package/package.json'), JSON.stringify({ name, version: '1.0.0' }));
    execFileSync('tar', ['--format=ustar', '-czf', join(root, archive), '-C', stage, 'package/package.json']);
    const bytes = readFileSync(join(root, archive));
    return { role, name, version: '1.0.0', archive, sha256: sha256(bytes), integrity: integrity(bytes), sourceHead: head };
  };
  const artifacts = [artifact('@fixture/l4', 'l4'), artifact('@fixture/mesh', 'mesh')];
  const receipt = { builtAgainstPreCandidateSha256: sha256(readFileSync(prePath)), e4ArtifactSha256: artifacts[0].sha256, sourceHead: head };
  const bytes = Buffer.from(JSON.stringify(receipt)); writeFileSync(join(root, 'build.json'), bytes);
  return { root, inputs: { artifacts, l4BuildReceipt: { path: 'build.json', sha256: sha256(bytes) } } };
}
it('preserves P3 contracts/peers and binds E4 to its measured build receipt', () => {
  const { root, inputs } = fixture(), manifest = assembleCandidate(root, prePath, inputs, head);
  const pre = JSON.parse(readFileSync(prePath));
  expect(manifest.artifacts.slice(0, 2)).toEqual(pre.artifacts);
  expect(manifest.contractInventory).toEqual(pre.contractInventory);
  expect(manifest.source.l5Head).toBe(head);
  inputs.artifacts[0].sha256 = 'b'.repeat(64);
  expect(() => assembleCandidate(root, prePath, inputs, head)).toThrow(/binding/);
});
it('rejects archive substitution, wrong identities and duplicate singleton roles', () => {
  const { root, inputs } = fixture(), a = inputs.artifacts[0];
  expect(() => verifyCandidateArchive(root, { ...a, name: '@fixture/forged' })).toThrow(/identity/);
  writeFileSync(join(root, a.archive), 'substituted');
  expect(() => verifyCandidateArchive(root, a)).toThrow(/digest/);
  inputs.artifacts.push({ ...a });
  expect(() => assembleCandidate(root, prePath, inputs, head)).toThrow(/duplicate|exactly one/);
});
it('keeps outputs immutable and refuses traversal and escaping symlink parents', () => {
  const { root } = fixture(), ref = writeImmutable(root, 'out/manifest.json', { value: 1 });
  expect(writeImmutable(root, ref.path, { value: 1 })).toEqual(ref);
  expect(() => writeImmutable(root, ref.path, { value: 2 })).toThrow(/immutable/);
  expect(() => writeImmutable(root, '../escape.json', {})).toThrow(/outside/);
  symlinkSync(tmpdir(), join(root, 'escape'));
  expect(() => writeImmutable(root, 'escape/new/manifest.json', {})).toThrow(/symlink/);
});
