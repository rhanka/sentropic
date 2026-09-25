// Eradication guard fixtures (make test-publishable-manifests).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { findViolations, workspaceManifests } from './eradicated-packages.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const fixture = (manifests) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eradicated-'));
  const all = { 'package.json': { name: 'ws', private: true, workspaces: ['api', 'packages/*'] }, ...manifests };
  for (const [rel, body] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), JSON.stringify(body));
  }
  return root;
};
const run = (manifests) => {
  const root = fixture(manifests);
  try {
    return findViolations(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

test('clean workspace passes; a registry range on @sentropic/focus is allowed', () => {
  assert.deepEqual(run({
    'api/package.json': { name: 'api', dependencies: { '@sentropic/focus': '^0.3.0', '@sentropic/flow': 'file:../packages/flow' } },
    'packages/flow/package.json': { name: '@sentropic/flow' },
  }), []);
});

for (const name of ['@sentropic/cli', '@sentropic/build-cli', '@sentropic/focus']) {
  test(`a workspace package named ${name} fails, whatever its directory`, () => {
    const violations = run({ 'packages/anything/package.json': { name } });
    assert.equal(violations.length, 1);
    assert.match(violations[0], new RegExp(`packages/anything/package.json: workspace package "${name}"`));
  });
}

test('local-path dependencies on @sentropic/focus fail in every dependency section', () => {
  for (const spec of ['file:../packages/focus', 'link:../focus', 'workspace:*', '../focus', './vendor/focus', '/abs/focus', ' file:x']) {
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const violations = run({ 'api/package.json': { name: 'api', [section]: { '@sentropic/focus': spec } } });
      assert.equal(violations.length, 1, `${section} ${spec}`);
      assert.match(violations[0], /local-path dependency on an eradicated package/);
    }
  }
});

test('the root manifest itself is checked', () => {
  const root = fixture({});
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ws', workspaces: [], devDependencies: { '@sentropic/focus': 'file:./x' } }));
    assert.equal(findViolations(root).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('unsupported workspace glob is an error, never a silent pass', () => {
  const root = fixture({});
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'ws', workspaces: ['packages/**'] }));
    assert.throws(() => findViolations(root), /unsupported workspace pattern/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('the repository itself passes and scans every packages/* workspace', () => {
  assert.deepEqual(findViolations(repoRoot), []);
  const files = workspaceManifests(repoRoot);
  assert.ok(files.includes('api/package.json'));
  assert.ok(files.filter((f) => f.startsWith('packages/')).length > 10);
});

test('ci.yml runs the guard in validate-publishable-manifests', () => {
  const ci = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = ci.slice(ci.indexOf('\n  validate-publishable-manifests:\n'), ci.indexOf('\n  build-e2e:\n'));
  assert.match(job, /run: make check-eradicated-packages ENV=test-ci-manifests\n/);
});
