import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// check-lock-integrity.mjs `siblings` and `refresh` on a fabricated sibling index (no archive needed).
const HERE = dirname(fileURLToPath(import.meta.url));
const run = (...args: string[]) => {
  const result = spawnSync(process.execPath, [join(HERE, 'check-lock-integrity.mjs'), ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout + result.stderr };
};
const MESH_URL = 'https://registry.npmjs.org/@sentropic/llm-mesh/-/llm-mesh-0.22.0.tgz';
const INTEGRITY = `sha512-${createHash('sha512').update('mesh bytes').digest('base64')}`;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cluster-lock-'));
  writeFileSync(join(dir, 'index.json'), JSON.stringify([
    { name: '@sentropic/llm-mesh', version: '0.22.0', file: '/x/mesh.tgz', integrity: INTEGRITY },
    { name: '@sentropic/cluster-mesh', version: '0.13.0', file: '/x/cluster.tgz', integrity: 'sha512-candidate' },
  ]));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@sentropic/llm-mesh': '0.22.0' } }));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function lock(file: string, mesh: Record<string, string>): string {
  const path = join(dir, file);
  writeFileSync(path, JSON.stringify({ packages: {
    '': {}, 'node_modules/@sentropic/cluster-mesh': { version: '0.13.0', integrity: 'sha512-build' },
    'node_modules/@sentropic/llm-mesh': mesh,
  } }));
  return path;
}

describe('train lock integrity', () => {
  it('should assert the committed lock version, resolved URL and integrity against the sibling bytes', () => {
    expect(run('siblings', lock('ok.json', { version: '0.22.0', resolved: MESH_URL, integrity: INTEGRITY }), dir).status).toBe(0);
    const stale = run('siblings', lock('stale.json', { version: '0.22.0', resolved: MESH_URL, integrity: 'sha512-stale' }), dir);
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('::error title=Train lock integrity::@sentropic/llm-mesh@0.22.0: lock integrity sha512-stale');
    const url = run('siblings', lock('url.json', { version: '0.22.0', resolved: 'file:/x/mesh.tgz', integrity: INTEGRITY }), dir);
    expect(url.out).toContain('lock resolved file:/x/mesh.tgz is not the registry URL');
  });

  it('should refresh sibling entries to the registry URL and sibling integrity, never the candidate', () => {
    const working = lock('working.json', { version: '0.22.0', resolved: 'file:x/mesh.tgz', integrity: 'sha512-provisional' });
    const committed = join(dir, 'committed.json');
    expect(run('refresh', working, committed, join(dir, 'package.json'), dir).status).toBe(0);
    const packages = JSON.parse(readFileSync(committed, 'utf8')).packages;
    expect(packages['node_modules/@sentropic/llm-mesh']).toEqual({ version: '0.22.0', resolved: MESH_URL, integrity: INTEGRITY });
    expect(packages['node_modules/@sentropic/cluster-mesh']).toEqual({ version: '0.13.0' });
  });

  it('should fail a refresh whose working lock pins another version of a sibling and write nothing', () => {
    const working = lock('working.json', { version: '0.21.2', resolved: 'https://x', integrity: 'sha512-old' });
    const committed = join(dir, 'committed.json');
    const result = run('refresh', working, committed, join(dir, 'package.json'), dir);
    expect(result.status).toBe(1);
    expect(result.out).toContain('@sentropic/llm-mesh@0.22.0 is a sibling but the working lock pins 0.21.2');
    expect(existsSync(committed)).toBe(false);
  });
});
