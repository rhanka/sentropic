import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { violations, inspect } from './ci-lockfile-installs.mjs';
import { installTools } from './locked-tools.mjs';
import { addLock, frozenRegistry, lockedVersions } from './frozen-registry.mjs';

test('should reject range resolution in CI, container, Make and script install paths', () => {
  for (const [file, source] of [
    ['Makefile', 'ci-tools:\n\tnpm install --prefix /tmp/tools typescript@5.4.5'],
    ['scripts/new.sh', 'npm i package@^1.0.0'],
    ['.github/workflows/new.yml', 'run: npx --yes tool@^1'],
    ['api/Dockerfile', 'RUN if test -f package-lock.json; then npm ci; else npm install; fi'],
    ['scripts/tool.mjs', "execFileSync('npm', ['install', 'tool@1.0.0']);"],
  ]) assert.equal(violations(file, source).length, 1, file);
  assert.deepEqual(violations('Makefile', 'lock-root:\n\tnpm install --package-lock-only\nbuild:\n\tnpm ci'), []);
  assert.deepEqual(violations('scripts/test.sh', 'npm ci\nnpx --no-install vitest run'), []);
});

test('should install tool graphs with npm ci and refuse uncommitted profiles', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-guard-'));
  try {
    const calls = [];
    installTools(['--prefix', dir, 'semver@7.7.2', '--ignore-scripts'], { run: (...args) => { calls.push(args); return { status: 0 }; } });
    assert.equal(calls[0][0], 'npm');
    assert.equal(calls[0][1][0], 'ci');
    assert.ok(calls[0][1].includes('--ignore-scripts'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package-lock.json'))).packages['node_modules/semver'].version, '7.7.2');
    assert.throws(() => installTools(['--prefix', dir, 'semver@999.0.0']), /No committed tool lock/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('should hide later registry publications and reject unknown packages', async () => {
  const versions = new Map();
  addLock(versions, { packages: { 'node_modules/locked-package': {
    version: '1.0.0', resolved: 'https://registry.npmjs.org/locked-package/-/locked-package-1.0.0.tgz', integrity: 'sha512-fixed',
    dependencies: { child: '^1.0.0' },
  } } });
  const registry = await frozenRegistry(versions);
  try {
    const metadata = await (await fetch(`${registry.url}/locked-package`)).json();
    assert.deepEqual(Object.keys(metadata.versions), ['1.0.0']);
    assert.equal(metadata.versions['1.0.0'].dist.integrity, 'sha512-fixed');
    assert.equal(metadata.versions['1.0.1'], undefined);
    assert.equal((await fetch(`${registry.url}/unknown`)).status, 404);
    assert.equal((await fetch(`${registry.url}/locked-package/-/locked-package-1.0.1.tgz`)).status, 404);
  } finally { await registry.close(); }
});

test('should have exact versions and integrity for every frozen registry artifact', () => {
  const root = new URL('../../', import.meta.url);
  for (const [name, entries] of lockedVersions(root.pathname)) for (const [version, entry] of entries) {
    assert.match(version, /^\d+\.\d+\.\d+(?:[-+].*)?$/, `${name} version`);
    assert.match(entry.dist.integrity, /^sha(?:1|256|384|512)-[A-Za-z0-9+/=]+$/, `${name}@${version} integrity`);
  }
});

test('should prevent unlocked installation paths across the repository', () => {
  assert.deepEqual(inspect(new URL('../../', import.meta.url).pathname), []);
});
