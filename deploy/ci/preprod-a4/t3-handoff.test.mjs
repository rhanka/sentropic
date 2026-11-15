import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recover } from './t3-window-driver.mjs';
import { loadState,saveState } from './t3-lib.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
test('watchdog handoff preserves fence intent persisted by a failed child', async () => {
  const stateDir = mkdtempSync(join(tmpdir(),'t3-handoff-'));
  const stale = { step: 'W1',fenceStarted: false,watchdogArmed: true,watchdogPid: 12345 };
  saveState(stateDir,{ ...stale,fenceStarted: true });
  const code = await recover({ stateDir,config: {},call: () => assert.fail('driver must delegate') },stale,'lost-fence-response');
  assert.equal(code,5); assert.equal(loadState(stateDir).fenceStarted,true);
});
test('rollback refuses a redirecting witness without following a second URL', async () => {
  const requests = [];
  const call = args => args[0] === 'get' && args[1] === 'pods' ? '{"items":[]}'
    : args[0] === 'get' && args[1] === 'cronjob' ? '{"spec":{"suspend":true}}' : '{}';
  await assert.rejects(preCommitRollback({ call,healthUrl: 'https://app.restore-a4.test/health',
    jwksUrl: 'https://auth.restore-a4.test/jwks',witness: { url: 'https://app.restore-a4.test/me',cookie: 'synthetic' },
    probe: async (url,options) => {
      requests.push(url); assert.equal(options.redirect,'error');
      return new Response('',{ status: url.endsWith('/me') ? 302 : 200 });
    } }),/rollback_witness_failed/);
  assert.equal(requests.length,3);
});
