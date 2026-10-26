import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { artifactsCompatible } from './helpers.js';

const releaseBaseOf = (version: string): string => version.split('-', 1)[0];
// Pack-only topic bump: a `-dev.N` prerelease of the SAME release base the
// frozen fixture pins (candidate `0.22.4-dev.1` vs frozen `0.22.4`). Anything
// else (stable, rc, or a different base) takes the strict pin path, so the
// tolerance never widens to an unrelated version.
const isPackOnlyDevBump = (candidateVersion: string, frozenBase: string): boolean =>
  candidateVersion.includes('-dev.') && releaseBaseOf(candidateVersion) === frozenBase;

describe('isPackOnlyDevBump', () => {
  it.each([
    ['0.22.4-dev.1', '0.22.4', true],
    ['0.22.4-dev.99', '0.22.4', true],
    ['0.22.4', '0.22.4', false],
    ['0.22.1', '0.22.2', false],
    ['0.22.3-dev.1', '0.22.2', false],
    ['0.22.2-rc.1', '0.22.2', false],
  ])('isPackOnlyDevBump(%s vs frozen %s) === %s', (candidate, frozen, expected) => {
    expect(isPackOnlyDevBump(candidate, frozen)).toBe(expected);
  });
});

it('should keep the frozen selected fixture aligned with the candidate release tuple', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/selected/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('./fixtures/selected/package-lock.json', import.meta.url), 'utf8'));
  expect(lock.packages[''].dependencies).toEqual(fixture.dependencies);
  const frozen = /^file:\.\.\/sentropic-cluster-mesh-(\d+\.\d+\.\d+)\.tgz$/.exec(
    fixture.dependencies['@sentropic/cluster-mesh'] as string,
  );
  expect(frozen, 'frozen fixture must pin a stable release tarball').not.toBeNull();
  const frozenBase = frozen![1];
  for (const slug of ['cluster-mesh', 'llm-mesh', 'llm-gateway']) {
    const candidate = JSON.parse(readFileSync(new URL(`../../../${slug}/package.json`, import.meta.url), 'utf8'));
    const spec = slug === 'cluster-mesh' ? `file:../sentropic-${slug}-${candidate.version}.tgz` : candidate.version;
    const entry = lock.packages[`node_modules/${candidate.name}`];
    if (slug === 'cluster-mesh' && isPackOnlyDevBump(candidate.version as string, frozenBase)) {
      // Pack-only topic bump: the frozen fixture keeps tracking the last release
      // tuple instead of churning per dev version; the lock entry must match it.
      expect(entry.version).toBe(frozenBase);
    } else {
      expect(fixture.dependencies[candidate.name]).toBe(spec);
      expect(entry.version).toBe(candidate.version);
    }
    expect(entry.dependencies).toEqual(candidate.dependencies);
    expect(entry.peerDependencies).toEqual(candidate.peerDependencies);
  }
});

it('should install only compatible packed artifacts and exclude an incompatible optional tuple without registry access', () => {
  const root = mkdtempSync(join(tmpdir(), 'prepare-artifacts-'));
  const work = join(root, 'work');
  try {
    // Stub npm's network operations while running the real preparation and source selection,
    // limited to the asserted artifacts-candidate consumers (prepare.sh default stays full).
    writeFileSync(join(root, 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === 'pack') {
  const dest = args[args.indexOf('--pack-destination') + 1];
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  fs.writeFileSync(path.join(dest, pkg.name.replace('@', '').replace('/', '-') + '-' + pkg.version + '.tgz'), JSON.stringify(pkg));
} else if (['install', 'ci'].includes(args[0]) && !args.includes('--prefix')) {
  fs.writeFileSync(path.join(process.cwd(), 'install-command.txt'), args[0]);
}
`, { mode: 0o755 });
    const result = spawnSync('sh', ['tests/packaging/prepare.sh', work], {
      cwd: new URL('../..', import.meta.url),
      env: { ...process.env, PATH: `${root}:${process.env.PATH}`, CLUSTER_MESH_SIBLING_RECEIPTS: '', CLUSTER_MESH_PREPARE_ONLY: 'artifacts' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    const dependency = (fixture: string) => JSON.parse(readFileSync(join(work, fixture, 'package.json'), 'utf8'))
      .dependencies['@sentropic/artifacts'] as string;
    if (!artifactsCompatible) {
      expect(dependency('selected')).toBeUndefined();
      expect(dependency('latest')).toBeUndefined();
      expect(existsSync(join(work, 'artifacts-consumer'))).toBe(false);
      expect(JSON.parse(readFileSync(join(work, 'artifacts-compatibility.json'), 'utf8')))
        .toEqual({ compatible: false });
      return;
    }
    const archive = dependency('artifacts-consumer');
    expect(archive).toMatch(/^file:/u);
    expect(dependency('selected')).toBe(archive);
    expect(dependency('latest')).toBe(archive);
    expect(readFileSync(join(work, 'selected', 'install-command.txt'), 'utf8')).toBe('install');
    const packed = JSON.parse(readFileSync(archive.slice(5), 'utf8'));
    const candidate = JSON.parse(readFileSync(new URL('../../../artifacts/package.json', import.meta.url), 'utf8'));
    expect({ name: packed.name, version: packed.version }).toEqual({ name: candidate.name, version: candidate.version });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
