import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { planArchives, topologicalOrder } from './archive-plan.mjs';
import { bootstrapWeb } from './npm-bootstrap-web.mjs';

const sha = 'a'.repeat(40);
const pkg = (name, dependencies) => ({ manifest: { name, dependencies } });

test('should order dependencies before consumers and reject cycles or duplicate identities', () => {
  const upstream = pkg('upstream');
  const downstream = pkg('downstream', { upstream: '^0.1.0' });
  assert.deepEqual(topologicalOrder([downstream, upstream]), [upstream, downstream]);
  upstream.manifest.optionalDependencies = { downstream: '^0.1.0' };
  assert.throws(() => topologicalOrder([downstream, upstream]), /cycle/);
  assert.throws(() => topologicalOrder([upstream, upstream]), /Duplicate/);
});

function fixture(fn) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-test-'));
  try {
    fs.mkdirSync(path.join(directory, 'package'));
    fs.writeFileSync(path.join(directory, 'package/package.json'), JSON.stringify({
      name: '@sentropic/ubo-contracts', version: '0.1.0', type: 'module',
    }));
    fs.mkdirSync(path.join(directory, 'ubo-contracts'));
    const archive = path.join(directory, 'ubo-contracts/ubo-contracts.tgz');
    assert.equal(spawnSync('tar', ['-czf', archive, 'package'], { cwd: directory }).status, 0);
    const receipt = {
      slug: 'ubo-contracts', name: '@sentropic/ubo-contracts', version: '0.1.0',
      archive, head_sha: sha, guard: 'pass', manifest_mode: 'block',
      sha256: createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    };
    const save = () => fs.writeFileSync(path.join(directory, 'ubo-contracts.receipt.json'), JSON.stringify(receipt));
    save();
    fn({ directory, receipt, save, archive, plan: () => planArchives(['ubo-contracts'], { directory, headSha: sha }) });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('should accept only the exact strictly guarded archive of the current commit', () => fixture(({ plan }) => {
  assert.equal(plan()[0].manifest.name, '@sentropic/ubo-contracts');
}));

test('should reject tampering before a login can begin', () => fixture(({ archive, plan }) => {
  fs.appendFileSync(archive, 'tampered');
  assert.throws(plan, /changed after verification/);
}));

test('should reject stale, failed, warn-only or mismatched receipts', () => {
  for (const [key, value] of [['head_sha', 'b'.repeat(40)], ['guard', 'fail'], ['manifest_mode', 'warn'], ['name', '@sentropic/wrong'], ['version', '9.9.9']]) {
    fixture(({ receipt, save, plan }) => {
      receipt[key] = value;
      save();
      assert.throws(plan, /strict guard|verified identity/);
    });
  }
});

test('should reject empty, unknown, duplicate or missing archives without authentication', () => {
  for (const slugs of [[], ['unknown'], ['ubo-contracts', 'ubo-contracts']]) {
    assert.throws(() => planArchives(slugs, { directory: '/missing', headSha: sha }), /distinct declared/);
  }
  assert.throws(() => planArchives(['ubo-contracts'], { directory: '/missing', headSha: sha }), /ENOENT/);
});

function fakeNpm(fail = () => null) {
  const calls = [];
  return {
    calls,
    run(args) {
      calls.push(args);
      const failure = fail(args);
      if (failure) return failure;
      if (args[0] === 'view') return { status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }) };
      return { status: 0, stdout: '' };
    },
  };
}
const release = { archive: '/verified/ubo.tgz', sha256: 'verified', manifest: { name: '@sentropic/ubo-contracts', version: '0.1.0' } };

test('should use web authentication, publish the verified archive and log out', () => {
  const npm = fakeNpm();
  bootstrapWeb([release], npm.run);
  assert.deepEqual(npm.calls.map((args) => args[0]), ['view', 'login', 'publish', 'logout']);
  assert.ok(npm.calls[1].includes('--auth-type=web'));
  assert.ok(npm.calls[2].includes(release.archive));
  assert.ok(npm.calls[2].includes('--provenance=false'));
  assert.ok(npm.calls[2].includes('--ignore-scripts'));
});

test('should log out after login or publication failure', () => {
  for (const command of ['login', 'publish']) {
    const npm = fakeNpm(([op]) => op === command ? { status: 1, stdout: '' } : null);
    assert.throws(() => bootstrapWeb([release], npm.run), /login|Publication/);
    assert.equal(npm.calls.at(-1)[0], 'logout');
    if (command === 'login') assert.ok(!npm.calls.some(([op]) => op === 'publish'));
  }
});

test('should fail before login when the registry is unavailable or a package already exists', () => {
  for (const result of [{ status: 0, stdout: '"0.1.0"' }, { status: 1, stdout: '{}' }]) {
    const npm = fakeNpm(([op]) => op === 'view' ? result : null);
    assert.throws(() => bootstrapWeb([release], npm.run), /already exists|lookup failed/);
    assert.deepEqual(npm.calls.map(([op]) => op), ['view']);
  }
});

test('should reject incompatible selected dependency versions before login', () => {
  const npm = fakeNpm();
  const consumer = { ...release, manifest: { name: '@sentropic/mcp-broker', version: '0.1.0', dependencies: { '@sentropic/ubo-contracts': '^9.0.0' } } };
  assert.throws(() => bootstrapWeb([release, consumer], npm.run), /does not satisfy/);
  assert.ok(!npm.calls.some(([op]) => op === 'login'));
});
