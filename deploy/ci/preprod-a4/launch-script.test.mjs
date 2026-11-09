import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { entrypoint } from '../../k8s/overlays/preprod/a4-runtime/launch.mjs';

const launcher = new URL('../../k8s/overlays/preprod/a4-runtime/launch.mjs', import.meta.url).pathname;

test('should map --script to the compiled api script under the same composition', () => {
  assert.deepEqual(entrypoint(['--script', 'cm-account-approve']), ['/workspace/api/dist/scripts/cm-account-approve.js']);
});

test('should keep the api and IdP entrypoints unchanged', () => {
  assert.deepEqual(entrypoint([]), ['/workspace/api/dist/index.js']);
  assert.deepEqual(entrypoint(['--idp']), ['/workspace/apps/auth-idp/dist/index.js']);
});

test('should refuse a script name that is not a plain compiled script name', () => {
  for (const args of [['--script'], ['--script', ''], ['--script', '../index'], ['--script', 'scripts/x'],
    ['--script', 'Cm-Approve'], ['--script', 'cm-account-approve.js'], ['--script', 'cm-account-approve', 'extra']]) {
    assert.throws(() => entrypoint(args), /launch_target_invalid/, JSON.stringify(args));
  }
});

test('should refuse an invalid target before composing any secret', () => {
  const run = spawnSync(process.execPath, [launcher, '--script', '../index'], { encoding: 'utf8',
    env: { PATH: process.env.PATH, EMAIL_CODE_HMAC_KEY_ACTIVE: 'not-a-key' }, timeout: 20000 });
  assert.equal(run.status, 1);
  assert.equal(run.stderr, 'launch_target_invalid\n');
});
