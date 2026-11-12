import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const here = new URL('.', import.meta.url).pathname;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function alive(pid) {
  try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; }
  catch { return false; }
}
async function until(check, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!check() && Date.now() < deadline) await sleep(20);
  assert.ok(check(), 'process observation deadline');
}

for (const mode of ['driver-dead', 'driver-stalled', 'emergency']) {
  test(`RUN6 actual driver child watchdog eliminates TERM-resistant descendants: ${mode}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 't3-process-'));
    const config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod',
      images: { candidate: 'c', ui: 'u' }, revisions: {} }));
    writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env node
const fs = require('node:fs'), a = process.argv.join(' ');
if (a.includes('scale deployment/api --replicas=0')) {
  fs.writeFileSync('${dir}/recovery', 'started');
  for (const name of ['worker','grandchild']) {
    try { const pid = fs.readFileSync('${dir}/'+name,'utf8');
      if (fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0] !== 'Z') process.exit(9);
    } catch {}
  }
}
if (a.includes('get pods')) console.log('{"items":[]}');
else if (a.includes('get cronjob sentropic-idp-identity-export')) console.log('{"spec":{"suspend":true}}');
else if (a.includes('exec ')) console.log('f|0');
else console.log('{}');
`, { mode: 0o700 });
    const program = `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { saveState, monoMs } from '${here}t3-lib.mjs';
      import { delivered } from '${here}t3-window-driver.mjs';
      const dir = ${JSON.stringify(dir)};
      saveState(dir, { step:'W3', driverPid:process.pid, childPid:process.pid,
        heartbeatMonoMs:monoMs(), t0MonoMs:monoMs(), stepDeadlineMonoMs:monoMs()+${mode === 'emergency' ? 30000 : 500} });
      const w = spawn(process.execPath, ['${here}t3-watchdog.mjs','--state-dir',dir,'--config','${config}'],
        { detached:true, stdio:'ignore' });
      writeFileSync(dir+'/watchdog',String(w.pid)); w.unref();
      delivered({stateDir:dir}, 't3-process-fixture.mjs', {T3_PROCESS_TEST_DIR:dir}, 30000);
    `;
    const driver = spawn(process.execPath, ['--input-type=module', '-e', program],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdio: ['ignore', 'ignore', openSync(join(dir, 'stderr'), 'w')] });
    try {
      await until(() => existsSync(join(dir, 'grandchild')));
      if (mode === 'driver-dead') driver.kill('SIGKILL');
      if (mode === 'emergency') {
        const out = spawnSync('sh', [`${here}t3-emergency.sh`, '--state-dir', dir, '--config', config],
          { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000 });
        assert.equal(out.status, 0, out.stderr);
        assert.match(out.stdout, /rollback_ok/);
      }
      await until(() => existsSync(join(dir, 'recovery')));
      for (const name of ['worker', 'grandchild']) {
        assert.equal(alive(Number(readFileSync(join(dir, name)))), false, `${name} must die before rollback`);
      }
      if (mode !== 'emergency') await until(() => JSON.parse(readFileSync(join(dir, 't3-window-state.json'))).watchdogDone);
    } finally {
      driver.kill('SIGKILL');
      for (const name of ['worker', 'grandchild', 'watchdog']) {
        try { process.kill(Number(readFileSync(join(dir, name))), 'SIGKILL'); } catch {}
      }
    }
  });
}
