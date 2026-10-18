import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { planArchives, topologicalOrder } from './archive-plan.mjs';

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
    const archive = path.join(directory, 'ubo-contracts.tgz');
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
