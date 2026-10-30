import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { violations, inspect } from './ci-lockfile-installs.mjs';
import { installTools } from './locked-tools.mjs';
import { addLock, candidateArchives, frozenRegistry, lockedVersions } from './frozen-registry.mjs';

test('should reject range resolution in CI, container, Make and script install paths', () => {
  for (const [file, source] of [
    ['Makefile', 'ci-tools:\n\tnpm install --prefix /tmp/tools typescript@5.4.5'],
    ['scripts/new.sh', 'npm i package@^1.0.0'],
    ['scripts/new.sh', 'npm x tool@^1'],
    ['scripts/new.sh', 'npm add tool@^1'],
    ['scripts/new.sh', 'npm --prefix /tmp/t install tool@^1'],
    ['scripts/tool.mjs', "execFileSync('npm', ['--prefix', '/tmp/t', 'install', 'tool@^1']);"],
    ['Makefile', 'build:\n\t$(NPM) install tool@^1'],
    ['.github/workflows/new.yml', 'run: npx --yes tool@^1'],
    ['api/Dockerfile', 'RUN if test -f package-lock.json; then npm ci; else npm install; fi'],
    ['scripts/tool.mjs', "execFileSync('npm', ['install', 'tool@1.0.0']);"],
    ['scripts/tool.mjs', "execFileSync('npm',\n ['install', 'tool@1.0.0']);"],
    ['scripts/tool.sh', 'npm \\\n install tool@1.0.0'],
    ['packages/tool/package.json', '{"scripts":{"build":"npx tool@^1"}}'],
    ['scripts/tool.mjs', "execFileSync('npx', ['tool@^1']);"],
    ['.github/workflows/new.yml', 'run: make lock-root ENV=test-ci'],
  ]) assert.equal(violations(file, source).length, 1, file);
  assert.deepEqual(violations('Makefile', 'lock-root:\n\tnpm install --package-lock-only\nbuild:\n\tnpm ci'), []);
  assert.deepEqual(violations('scripts/test.sh', 'npm ci\nnpx --no-install vitest run'), []);
  assert.deepEqual(violations('api/Dockerfile', 'RUN rm /usr/local/bin/npx /root/.npm && ! command -v npx && test -e /app'), []);
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

test('should install real candidate tarballs and replay their lock after closing the registry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'locked-candidate-'));
  try {
    const archives = path.join(dir, 'archives');
    fs.mkdirSync(archives);
    for (const name of ['locked-parent', 'locked-child']) {
      const stage = path.join(dir, name, 'package');
      fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name, version: '1.0.0',
        ...(name === 'locked-parent' ? { dependencies: { 'locked-child': '^1.0.0' } } : {}) }));
      execFileSync('tar', ['-czf', path.join(archives, `${name}.tgz`), '-C', path.dirname(stage), 'package']);
    }
    const cwd = path.join(dir, 'consumer');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"private":true}');
    execFileSync(process.execPath, [new URL('./locked-consumer.mjs', import.meta.url).pathname,
      path.join(archives, 'locked-parent.tgz'), path.join(archives, 'locked-child.tgz'), '--ignore-scripts'], { cwd, stdio: 'pipe' });
    const lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json')));
    assert.equal(path.resolve(cwd, lock.packages['node_modules/locked-child'].resolved.slice(5)), `${archives}/locked-child.tgz`);
    assert.equal(fs.lstatSync(path.join(cwd, 'node_modules/locked-parent')).isSymbolicLink(), false);
    execFileSync('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, stdio: 'pipe' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/locked-child/package.json'))).version, '1.0.0');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('should prevent unlocked installation paths in the declared scan trees and file types', () => {
  assert.deepEqual(inspect(new URL('../../', import.meta.url).pathname), []);
});

test('should admit only named candidates and manifest file specs, never stray siblings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'candidate-shadow-'));
  try {
    fs.mkdirSync(path.join(dir, 'src'));
    for (const name of ['primary', 'explicit', 'stray', 'src/stray']) fs.writeFileSync(path.join(dir, `${name}.tgz`), 'stray');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { explicit: 'file:explicit.tgz' } }));
    assert.deepEqual(candidateArchives(['primary.tgz'], dir).sort(), ['explicit.tgz', 'primary.tgz'].map(name => path.join(dir, name)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('should install the locked transitive version even when upstream publishes a newer match', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'publication-race-'));
  const stage = path.join(dir, 'package');
  fs.mkdirSync(stage);
  const artifacts = new Map();
  for (const version of ['1.0.0', '1.0.1']) {
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'race-child', version }));
    const archive = path.join(dir, `${version}.tgz`);
    execFileSync('tar', ['-czf', archive, '-C', dir, 'package']);
    artifacts.set(version, fs.readFileSync(archive));
  }
  let metadataRequests = 0;
  const upstream = http.createServer((req, res) => {
    if (req.url.endsWith('.tgz')) { res.end(artifacts.get(req.url.slice(1, -4))); return; }
    metadataRequests += 1;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ name: 'race-child', 'dist-tags': { latest: '1.0.1' }, versions: {
      '1.0.1': { name: 'race-child', version: '1.0.1', dist: { tarball: `${upstreamUrl}/1.0.1.tgz` } },
    } }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
  const registry = await frozenRegistry(new Map([['race-child', new Map([['1.0.0', {
    name: 'race-child', version: '1.0.0', dist: { tarball: `${upstreamUrl}/1.0.0.tgz`,
      integrity: `sha512-${createHash('sha512').update(artifacts.get('1.0.0')).digest('base64')}` },
  }]])]]));
  try {
    const cwd = path.join(dir, 'consumer');
    fs.mkdirSync(cwd);
    fs.writeFileSync(path.join(cwd, 'package.json'), '{"private":true,"dependencies":{"race-child":"^1.0.0"}}');
    const code = await new Promise((resolve, reject) => {
      const child = spawn('npm', ['install', '--registry', registry.url, '--cache', path.join(dir, 'cache'),
        '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, stdio: 'ignore' });
      child.once('error', reject); child.once('close', resolve);
    });
    assert.equal(code, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, 'node_modules/race-child/package.json'))).version, '1.0.0');
    assert.equal(metadataRequests, 0, 'live registry metadata must never influence the install');
  } finally {
    await registry.close();
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
