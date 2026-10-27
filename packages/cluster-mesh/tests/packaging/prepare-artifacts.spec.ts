import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPackOnlyDevBump, RESERVED_NEXT } from '../fixtures/reserved-versions.js';
import { artifactsCompatible } from './helpers.js';

type CandidatePackage = {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// Frozen-pin extraction shared by the file-driven and synthetic checks: the
// fixture must pin a stable release tarball, never a prerelease.
const frozenBaseOf = (fixtureDependencies: Record<string, string>): string => {
  const frozen = /^file:\.\.\/sentropic-cluster-mesh-(\d+\.\d+\.\d+)\.tgz$/.exec(
    fixtureDependencies['@sentropic/cluster-mesh'],
  );
  expect(frozen, 'frozen fixture must pin a stable release tarball').not.toBeNull();
  return frozen![1];
};

// Single-candidate alignment: the pack-only tolerance applies to the
// cluster-mesh candidate only, and only for a `<reservedNext>-dev.N` workspace
// version against the latest published pin; every other shape takes the strict
// pin path (fixture spec and lock entry must equal the candidate version).
const checkCandidateAlignment = (
  candidate: CandidatePackage,
  fixtureDependencies: Record<string, string>,
  lockPackages: Record<string, { version?: string; dependencies?: unknown; peerDependencies?: unknown }>,
): void => {
  const entry = lockPackages[`node_modules/${candidate.name}`];
  const frozenBase = frozenBaseOf(fixtureDependencies);
  if (candidate.name === '@sentropic/cluster-mesh'
    && isPackOnlyDevBump(candidate.version, frozenBase, RESERVED_NEXT)) {
    // Pack-only topic bump: the frozen fixture keeps tracking the last release
    // tuple instead of churning per dev version; the lock entry must match it.
    expect(entry.version).toBe(frozenBase);
  } else {
    const spec = candidate.name === '@sentropic/cluster-mesh'
      ? `file:../sentropic-cluster-mesh-${candidate.version}.tgz`
      : candidate.version;
    expect(fixtureDependencies[candidate.name]).toBe(spec);
    expect(entry.version).toBe(candidate.version);
  }
  expect(entry.dependencies).toEqual(candidate.dependencies);
  expect(entry.peerDependencies).toEqual(candidate.peerDependencies);
};

describe('isPackOnlyDevBump', () => {
  it.each([
    ['0.24.0-dev.1', '0.22.4', '0.24.0', true],
    ['0.24.0-dev.99', '0.22.4', '0.24.0', true],
    ['0.22.1', '0.22.4', '0.24.0', false],
    ['0.22.4', '0.22.4', '0.24.0', false],
    ['0.25.0-dev.1', '0.22.4', '0.24.0', false],
    ['0.23.0-dev.14', '0.22.4', '0.24.0', false],
    ['0.24.0-dev.1', '0.22.4', '0.25.0', false],
    ['0.24.0-dev.1', '0.22.1', '0.24.0', false],
    ['0.24.0-dev.1', '0.24.0', '0.24.0', false],
    ['0.24.0-rc.1', '0.22.4', '0.24.0', false],
  ])('isPackOnlyDevBump(%s, %s, %s) === %s', (workspaceVersion, publishedPin, reservedNext, expected) => {
    expect(isPackOnlyDevBump(workspaceVersion, publishedPin, reservedNext)).toBe(expected);
  });
});

it('should keep the frozen selected fixture aligned with the candidate release tuple', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/selected/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(readFileSync(new URL('./fixtures/selected/package-lock.json', import.meta.url), 'utf8'));
  expect(lock.packages[''].dependencies).toEqual(fixture.dependencies);
  for (const slug of ['cluster-mesh', 'llm-mesh', 'llm-gateway']) {
    const candidate = JSON.parse(readFileSync(new URL(`../../../${slug}/package.json`, import.meta.url), 'utf8'));
    checkCandidateAlignment(candidate, fixture.dependencies, lock.packages);
  }
});

describe('pack-only dev alignment', () => {
  const files = () => ({
    fixture: JSON.parse(readFileSync(new URL('./fixtures/selected/package.json', import.meta.url), 'utf8')),
    lock: JSON.parse(readFileSync(new URL('./fixtures/selected/package-lock.json', import.meta.url), 'utf8')),
    candidate: JSON.parse(readFileSync(new URL('../../../cluster-mesh/package.json', import.meta.url), 'utf8')),
  });

  it('should apply the frozen pin to a reserved-next dev candidate in CI', () => {
    const { fixture, lock, candidate } = files();
    expect(() => checkCandidateAlignment(
      { ...candidate, version: `${RESERVED_NEXT}-dev.1` }, fixture.dependencies, lock.packages,
    )).not.toThrow();
  });

  it('should keep the strict path for a stale pin under a reserved-next dev candidate', () => {
    const { fixture, lock, candidate } = files();
    const staleDependencies = {
      ...fixture.dependencies,
      '@sentropic/cluster-mesh': 'file:../sentropic-cluster-mesh-0.22.1.tgz',
    };
    const stalePackages = {
      ...lock.packages,
      'node_modules/@sentropic/cluster-mesh': {
        ...lock.packages['node_modules/@sentropic/cluster-mesh'],
        version: '0.22.1',
      },
    };
    expect(() => checkCandidateAlignment(
      { ...candidate, version: `${RESERVED_NEXT}-dev.1` }, staleDependencies, stalePackages,
    )).toThrow();
  });

  it('should keep the strict path for a stable candidate that is not the pin', () => {
    const { fixture, lock, candidate } = files();
    expect(() => checkCandidateAlignment(
      { ...candidate, version: '0.22.1' }, fixture.dependencies, lock.packages,
    )).toThrow();
  });
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
