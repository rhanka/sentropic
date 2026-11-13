import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { probeEndpoints } from './t3-probe-fixture.mjs';

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

const cases = [
  ...['driver-dead', 'driver-stalled', 'emergency'].map(mode => ({ mode, step: 'W3' })),
  ...['fence', 'restrict', 'wire', 'budgets', 'custodian', 'stage:inputs', 'snapshot',
    'stage:rehearsal', 'checkpoint', 'delete-custodian', 'start-api'].map(operation => ({ mode: 'driver-dead', operation })),
  ...['W0', 'W8', 'W9'].map(step => ({ mode: 'driver-dead', step })),
  ...['POSTCOMMIT_RESTRICTED', 'ACCEPTED', 'BACKUP_RESUMED', 'ONE_HOST_OPEN', 'TWO_HOSTS_OPEN']
    .map(substate => ({ mode: 'driver-dead', step: 'W8', substate, committed: true })),
];
for (const { mode, step, operation, substate, committed = false } of cases) {
  test(`RUN6 actual driver child watchdog eliminates TERM-resistant descendants: ${mode} ${operation ?? step} ${substate ?? ''}`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 't3-process-'));
    const config = join(dir, 'config.json');
    const http = spawn(process.execPath, [`${here}t3-probe-fixture.mjs`, join(dir, 'port')], { stdio: 'ignore' });
    await until(() => existsSync(join(dir, 'port')));
    const endpoints = probeEndpoints(`http://127.0.0.1:${readFileSync(join(dir, 'port'), 'utf8')}`);
    writeFileSync(config, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod',
      endpoints, images: { candidate: 'c', ui: 'u' }, revisions: {}, request: { operationId: 'process-test' } }));
    writeFileSync(join(dir, 'kubectl'), `#!/usr/bin/env node
const fs = require('node:fs'), a = process.argv.join(' ');
fs.appendFileSync('${dir}/commands', a+'\\n');
if (a.includes('scale deployment/api --replicas=0')) {
  fs.writeFileSync('${dir}/recovery', 'started');
  for (const name of ['worker','grandchild']) {
    try { const pid = fs.readFileSync('${dir}/'+name,'utf8');
      if (fs.readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0] !== 'Z') process.exit(9);
    } catch {}
  }
}
const scale = a.match(/scale deployment\\/(\\S+) --replicas=(\\d)/);
if (scale) fs.writeFileSync('${dir}/replicas-'+scale[1], scale[2]);
if (a.includes('get pods')) console.log('{"items":[]}');
else if (a.includes('get cronjob sentropic-idp-identity-export')) console.log('{"spec":{"suspend":true}}');
else if (a.includes('get middleware')) console.log('{"spec":{"ipAllowList":{"sourceRange":["9.9.9.9/32"]}}}');
else if (a.includes('get deployment')) {
  const name = a.match(/get deployment (\\S+)/)[1];
  let replicas = 0; try { replicas = Number(fs.readFileSync('${dir}/replicas-'+name)); } catch {}
  console.log(JSON.stringify({spec:{replicas,template:{spec:{containers:[{name,image:name==='ui'?'u':'c'}]}}},
    status:{readyReplicas:replicas,observedGeneration:1},metadata:{generation:1}}));
}
else if (a.includes('exec ')) {
  const sql = fs.readFileSync(0,'utf8');
  console.log(sql.includes('journal_present') ? '${committed ? 't' : 'f'}|0'
    : sql.includes('identity_committed') ? '${committed ? 't' : 'f'}' : sql.includes('to_regclass(name)') ? 'relation|t' : 'f');
}
else console.log('{}');
`, { mode: 0o700 });
    const program = `
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import { saveState, monoMs, runKubectl } from '${here}t3-lib.mjs';
      import { delivered, drive } from '${here}t3-window-driver.mjs';
      const dir = ${JSON.stringify(dir)};
      if (!${JSON.stringify(operation ?? null)}) saveState(dir, { step:${JSON.stringify(step ?? 'W0')}, substate:${JSON.stringify(substate ?? null)},
        middlewareSpec:{ipAllowList:{sourceRange:['9.9.9.9/32']}}, namespace:'sentropic-preprod', driverPid:process.pid, childPid:process.pid,
        heartbeatMonoMs:monoMs(), t0MonoMs:monoMs(), stepDeadlineMonoMs:monoMs()+${mode === 'emergency' ? 30000 : 500} });
      const w = spawn(process.execPath, ['${here}t3-watchdog.mjs','--state-dir',dir,'--config','${config}'],
        { detached:true, stdio:'ignore' });
      writeFileSync(dir+'/watchdog',String(w.pid)); w.unref();
      const block = () => delivered({stateDir:dir}, 't3-process-fixture.mjs', {T3_PROCESS_TEST_DIR:dir}, 30000);
      if (${JSON.stringify(operation ?? null)}) {
        await drive({stateDir:dir, watchdogPid:w.pid, config:${readFileSync(config, 'utf8')},
          dryRun:true, print:()=>{}, call:runKubectl({stateDir:dir,namespace:'sentropic-preprod'}),
          delivered:(c,s,e)=> {
            const op = e.A4_STAGE ? 'stage:'+e.A4_STAGE : e.A4_ACTION ?? e.A4_OPERATION ?? e.A4_PHASE;
            if (op === ${JSON.stringify(operation ?? null)}) return block();
            return '';
          }});
      } else block();
    `;
    const driver = spawn(process.execPath, ['--input-type=module', '-e', program],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, stdio: ['ignore', 'ignore', openSync(join(dir, 'stderr'), 'w')] });
    try {
      await until(() => existsSync(join(dir, 'grandchild')));
      if (mode === 'driver-dead') driver.kill('SIGKILL');
      if (mode === 'emergency') {
        const out = spawnSync('sh', [`${here}t3-emergency.sh`, '--state-dir', dir, '--config', config],
          { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000 });
        assert.equal(out.status, 0, `${out.error?.message ?? ''}\n${out.stderr}\n${out.stdout}`);
        assert.match(out.stdout, /rollback_ok/);
      }
      await until(() => existsSync(join(dir, 'recovery')));
      for (const name of ['worker', 'grandchild']) {
        assert.equal(alive(Number(readFileSync(join(dir, name)))), false, `${name} must die before rollback`);
      }
      if (mode !== 'emergency') await until(() => JSON.parse(readFileSync(join(dir, 't3-window-state.json'))).watchdogDone);
      const commands = readFileSync(join(dir, 'commands'), 'utf8');
      if (committed) {
        assert.doesNotMatch(commands, /rollout undo|patch secret sentropic-api/);
        assert.equal(JSON.parse(readFileSync(join(dir, 't3-window-state.json'))).substate, 'TWO_HOSTS_OPEN');
      }
    } finally {
      http?.kill('SIGKILL');
      driver.kill('SIGKILL');
      for (const name of ['worker', 'grandchild', 'watchdog']) {
        try { process.kill(Number(readFileSync(join(dir, name))), 'SIGKILL'); } catch {}
      }
    }
  });
}
