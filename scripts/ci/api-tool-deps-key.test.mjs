import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { depsKey } from './api-tool-deps-key.mjs';

const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
// Minimal workspace repo: api and packages/b depend on packages/a (by path and by range).
const fixture = () => ({
  'package.json': { name: 'root', private: true, workspaces: ['api', 'packages/*'] },
  'package-lock.json': { name: 'root', lockfileVersion: 3, requires: true, packages: {
    '': { name: 'root', workspaces: ['api', 'packages/*'] },
    api: { name: 'api', version: '0.1.0', dependencies: { '@x/a': 'file:../packages/a', 'left-pad': '^1.3.0' } },
    'packages/a': { name: '@x/a', version: '1.0.0', license: 'MIT', dependencies: { 'left-pad': '^1.3.0' } },
    'packages/b': { name: '@x/b', version: '2.0.0', dependencies: { '@x/a': '^1.0.0' } },
    'node_modules/@x/a': { resolved: 'packages/a', link: true },
    'node_modules/@x/b': { resolved: 'packages/b', link: true },
    'node_modules/api': { resolved: 'api', link: true },
    'node_modules/left-pad': { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-AAAA' },
  } },
  'api/package.json': { name: 'api', version: '0.1.0', dependencies: { '@x/a': 'file:../packages/a', 'left-pad': '^1.3.0' } },
  'packages/a/package.json': { name: '@x/a', version: '1.0.0', main: 'dist/index.js', exports: { '.': './dist/index.js' },
    dependencies: { 'left-pad': '^1.3.0' } },
  'packages/b/package.json': { name: '@x/b', version: '2.0.0', dependencies: { '@x/a': '^1.0.0' } },
  'api/Dockerfile': 'FROM node\n',
});
const key = tree => depsKey(new Map(Object.entries(tree).map(([path, value]) => [path, typeof value === 'string' ? Buffer.from(value) : json(value)])));
const edit = mutate => {
  const tree = fixture();
  mutate(tree, tree['package-lock.json'].packages);
  return key(tree);
};
const release = (tree, lock, dir, version) => {
  lock[dir].version = version;
  tree[`${dir}/package.json`].version = version;
};
const base = key(fixture());

test('should keep the key when only workspace versions move inside every dependent range', () => {
  assert.match(base, /^tooldeps-[a-f0-9]{64}$/);
  assert.equal(edit((tree, lock) => release(tree, lock, 'packages/a', '1.4.2')), base);
  assert.equal(edit((tree, lock) => { release(tree, lock, 'packages/b', '3.0.0'); release(tree, lock, 'api', '0.2.0'); }), base);
  assert.equal(edit((tree, lock) => { lock['packages/a'].version = '1.0.1'; }), base);
});

test('should keep the key on a manifest reformat and move it on any workspace field other than version', () => {
  assert.equal(edit(tree => { tree['packages/b/package.json'] = JSON.stringify(tree['packages/b/package.json']); }), base);
  for (const field of [{ description: 'A' }, { files: ['dist'] }, { types: 'dist/a.d.ts' }, { main: 'dist/a.js' },
    { exports: { '.': './dist/index.js', './live': './dist/live.js' } }, { publishConfig: { access: 'public' } }]) {
    assert.notEqual(edit(tree => Object.assign(tree['packages/a/package.json'], field)), base, JSON.stringify(field));
  }
});

test('should change the key when an external entry, a dependency edge or an install input changes', () => {
  const pad = lock => lock['node_modules/left-pad'];
  for (const mutate of [
    (tree, lock) => { pad(lock).version = '1.3.1'; },
    (tree, lock) => { pad(lock).integrity = 'sha512-BBBB'; },
    (tree, lock) => { pad(lock).resolved = 'https://registry.example/left-pad-1.3.0.tgz'; },
    (tree, lock) => { pad(lock).dependencies = { tslib: '^2.0.0' }; },
    (tree, lock) => { lock['packages/a'].dependencies['left-pad'] = '^1.4.0'; },
    tree => { tree['packages/a/package.json'].dependencies['left-pad'] = '^1.4.0'; },
    tree => { tree['packages/b/package.json'].devDependencies = { '@x/a': '^1.0.0' }; },
    tree => { tree['packages/a/package.json'].scripts = { postinstall: 'node setup.js' }; },
    tree => { tree['packages/a/package.json'].bin = { a: 'bin/a.js' }; },
    tree => { tree['package.json'].version = '1.0.0'; },
    tree => { tree['api/Dockerfile'] = 'FROM node:24\n'; },
  ]) assert.notEqual(edit(mutate), base);
});

test('should change the key when a workspace entry that changes dependencies is added or removed', () => {
  const manifest = { name: '@x/c', version: '0.1.0', dependencies: { 'left-pad': '^1.3.0' } };
  assert.notEqual(edit((tree, lock) => {
    lock['packages/c'] = { ...manifest };
    lock['node_modules/@x/c'] = { resolved: 'packages/c', link: true };
    tree['packages/c/package.json'] = manifest;
  }), base);
  assert.notEqual(edit((tree, lock) => {
    delete lock['packages/b'];
    delete lock['node_modules/@x/b'];
    delete tree['packages/b/package.json'];
  }), base);
});

test('should change the key when a version bump flips the validity of a range edge', () => {
  assert.notEqual(edit((tree, lock) => release(tree, lock, 'packages/a', '2.0.0')), base);
  assert.notEqual(edit((tree, lock) => release(tree, lock, 'packages/a', '1.1.0-dev.1')), base);
  assert.notEqual(edit(tree => { tree['packages/a/package.json'].version = '0.9.0'; }), base);
});

test('should keep the version in the key when the validity of an edge cannot be evaluated', () => {
  const loose = (tree, lock) => {
    lock['packages/b'].dependencies['@x/a'] = '1.x';
    tree['packages/b/package.json'].dependencies['@x/a'] = '1.x';
  };
  assert.notEqual(edit((tree, lock) => { loose(tree, lock); release(tree, lock, 'packages/a', '1.0.1'); }), edit(loose));
  const override = tree => { tree['package.json'].overrides = { '@x/a': '1.0.0' }; };
  assert.notEqual(edit((tree, lock) => { override(tree); release(tree, lock, 'packages/a', '1.0.1'); }), edit(override));
  assert.notEqual(edit((tree, lock) => release(tree, lock, 'packages/a', 'v1.0.1')),
    edit((tree, lock) => release(tree, lock, 'packages/a', 'v1.0.0')));
});

test('should hash an unparseable lock byte for byte', () => {
  const broken = '{ "lockfileVersion": 3, "packages": {';
  assert.notEqual(key({ ...fixture(), 'package-lock.json': broken }), key({ ...fixture(), 'package-lock.json': `${broken} ` }));
});

// The real repository, as listed by the INPUTS pathspecs (the test image has no git).
const repoFiles = () => {
  const paths = ['.dockerignore', '.security/audit-allowlist.json', '.security/audit-gate.mjs', 'api/Dockerfile', 'api/package.json',
    'package-lock.json', 'package.json', 'scripts/ci/api-tool-deps-key.mjs', 'scripts/ci/locked-tools.mjs', 'scripts/ci/tool-locks.json',
    ...readdirSync('packages').map(dir => `packages/${dir}/package.json`)];
  return new Map(paths.filter(path => existsSync(path)).map(path => [path, readFileSync(path)]));
};

test('should keep the real key across a workspace version release and move it on an export or external lock change', () => {
  const files = repoFiles();
  const real = depsKey(files);
  const lock = JSON.parse(files.get('package-lock.json'));
  const manifest = JSON.parse(files.get('packages/artifacts/package.json'));
  const [major, minor, patch] = manifest.version.split('.').map(Number);
  const next = `${major}.${minor}.${patch + 1}`;
  lock.packages['packages/artifacts'].version = next;
  const released = new Map(files)
    .set('package-lock.json', json(lock))
    .set('packages/artifacts/package.json', json({ ...manifest, version: next }));
  assert.equal(depsKey(released), real);
  assert.notEqual(depsKey(new Map(released).set('packages/artifacts/package.json',
    json({ ...manifest, version: next, exports: { ...manifest.exports, './next': './dist/next.js' } }))), real);
  const external = Object.keys(lock.packages).find(name => name.startsWith('node_modules/') && lock.packages[name].integrity);
  lock.packages[external].integrity = `sha512-${'A'.repeat(86)}==`;
  assert.notEqual(depsKey(new Map(released).set('package-lock.json', json(lock))), real);
});
