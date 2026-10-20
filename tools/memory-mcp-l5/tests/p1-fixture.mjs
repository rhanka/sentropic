import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ANCILLARY } from '../precandidate.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
export function p1Fixture(extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-fixture-')), head = 'a'.repeat(40), inv = [], artifacts = [];
  const put = (path, bytes) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes); };
  put('package-lock.json', readFileSync('package-lock.json'));
  for (const path of ANCILLARY) {
    const bytes = readFileSync(path); put(path, bytes);
    inv.push({ path, version: path.startsWith('packages/') ? '0.4.0' : '1.0.0', sha256: sha(bytes) });
  }
  for (const [slug, role] of [['mcp-platform', 'platform'], ['mcp-broker', 'broker']]) {
    const name = `@sentropic/${slug}`, prefix = `packages/${slug}`;
    const pkg = { name, version: '0.4.0', type: 'module', exports: { './memory': { import: './dist/memory/index.js', types: './dist/memory/index.d.ts' } } };
    const files = { 'package.json': JSON.stringify(pkg), 'dist/memory/index.js': 'export const value = true;',
      'dist/memory/index.d.ts': 'export declare const value: true;', ...(role === 'broker' ? extra : {}) };
    const stage = `${prefix}/stage`;
    for (const [path, bytes] of Object.entries(files)) {
      put(`${stage}/package/${path}`, bytes);
      inv.push({ path: `${prefix}/${path}`, version: '0.4.0', sha256: sha(bytes) });
    }
    const archive = `archives/${slug}.tgz`; mkdirSync(join(root, 'archives'), { recursive: true });
    execFileSync('tar', ['--format=ustar', '-czf', join(root, archive), '-C', join(root, stage), ...Object.keys(files).map(p => `package/${p}`)]);
    const bytes = readFileSync(join(root, archive));
    artifacts.push({ role, name, version: '0.4.0', sha256: sha(bytes), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`, sourceHead: head, archive });
  }
  const freeze = JSON.parse(readFileSync(join(root, 'spec/evidence/memory-mcp-l5/l0-freeze.json')));
  const manifest = { manifestVersion: 1, stage: 'pre-candidate', source: { specSha256: freeze.specSha256,
    l0Commit: freeze.l0Commit, br3Commit: head, l5Head: head, sdkRange: '^1.31.0', declaredLockSha256: sha(readFileSync('package-lock.json')) },
    artifacts, contractInventory: inv.sort((a, b) => a.path.localeCompare(b.path)) };
  const save = () => { const bytes = `${JSON.stringify(manifest, null, 2)}\n`; put('manifest.json', bytes); put('manifest.json.sha256', `${sha(bytes)}\n`); };
  save();
  return { root, manifest, save, put };
}
