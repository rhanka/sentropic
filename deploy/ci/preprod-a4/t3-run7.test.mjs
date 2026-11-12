import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadState, monoMs } from './t3-lib.mjs';
import { poll } from './t3-watchdog.mjs';

const here = new URL('.', import.meta.url).pathname;
test('RUN7 driver CLI preview preserves active state, request and recovery claim byte for byte', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-preview-'));
  const config = join(dir, 'config.json');
  writeFileSync(config, JSON.stringify({ namespace: 'sentropic-preprod', images: { candidate: 'c', ui: 'u' }, request: {} }));
  const files = { 't3-window-state.json': JSON.stringify({ step: 'W3', driverPid: process.pid }),
    'request.json': 'active request', 't3-recovering.lock': `pid-${process.pid}|1` };
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  const out = spawnSync(process.execPath, [`${here}t3-window-driver.mjs`, '--config', config,
    '--state-dir', dir, '--dry-run'], { encoding: 'utf8', timeout: 5000 });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /preview_active_state/);
  for (const [name, bytes] of Object.entries(files)) assert.equal(readFileSync(join(dir, name), 'utf8'), bytes, name);
});

test('RUN7 watchdog kills a SIGSTOP recovery owner before its only writer restores service', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-recovery-stop-'));
  const driver = spawn(process.execPath, ['--input-type=module', '-e', `
    import { recover } from '${here}t3-window-driver.mjs';
    import { monoMs } from '${here}t3-lib.mjs';
    await recover({stateDir:${JSON.stringify(dir)}, config:{}, recoveryBudgetMs:400,
      call:()=>process.kill(process.pid,'SIGSTOP')},
      {step:'W3',driverPid:process.pid,t0MonoMs:monoMs(),heartbeatMonoMs:monoMs()-2000},'test');
  `], { stdio: 'ignore' });
  try {
    const until = Date.now() + 3000;
    while (!loadState(dir)?.recoveryReason && Date.now() < until) await new Promise(r => setTimeout(r, 20));
    assert.ok(loadState(dir)?.recoveryReason, 'driver must enter real recover()');
    await new Promise(r => setTimeout(r, 1100));
    let writes = 0;
    const code = await poll({ stateDir: dir, config: { revisions: {} }, print: () => {}, call: args => {
      let running = false;
      try { running = readFileSync(`/proc/${driver.pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch {}
      assert.equal(running, false, 'old writer must be dead before any recovery command');
      writes++;
      const cmd = args.join(' ');
      if (cmd.includes('get pods')) return '{"items":[]}';
      if (cmd.includes('exec')) return 'f|0';
      if (cmd.includes('get cronjob')) return '{"spec":{"suspend":true}}';
      return '{}';
    } });
    assert.equal(code, 3);
    assert.ok(writes > 0);
    assert.equal(loadState(dir).step, 'DONE');
  } finally { driver.kill('SIGKILL'); }
});
