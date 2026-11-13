import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emailProbe, expectedSigningKid, probeEndpoints } from './t3-probe-fixture.mjs';
import { loadState } from './t3-lib.mjs';

const here = new URL('.', import.meta.url).pathname;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) {
  const end = Date.now() + 4000;
  while (!check() && Date.now() < end) await sleep(20);
  assert.ok(check(), 'startup observation deadline');
}
for (const mode of ['suspend-parent', 'watchdog-fails']) {
  test(`RUN8 startup ${mode} cannot enter fence without armed watchdog`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 't3-startup-'));
    const config = join(dir, 'config.json'), preload = join(dir, 'preload.mjs');
    writeFileSync(config, JSON.stringify({ namespace: 'sentropic-preprod', endpoints: probeEndpoints(),
      emailProbe, expectedSigningKid, images: { candidate: 'c', ui: 'u' }, request: {} }));
    writeFileSync(preload, `
      import cp from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      import { writeFileSync } from 'node:fs';
      const original = cp.spawn;
      cp.spawn = (cmd, args, opts) => {
        if (!args.some(a => a.endsWith('t3-watchdog.mjs'))) return original(cmd,args,opts);
        const child = original(cmd, ${mode === 'watchdog-fails' ? "['-e','process.exit(9)']" : 'args'}, opts);
        writeFileSync(${JSON.stringify(join(dir, 'watchdog'))}, String(child.pid));
        ${mode === 'suspend-parent' ? "process.kill(process.pid,'SIGSTOP');" : ''}
        return child;
      };
      syncBuiltinESMExports();
    `);
    const child = spawn(process.execPath, ['--import', preload, `${here}t3-window-driver.mjs`,
      '--config', config, '--state-dir', dir, '--dry-run'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.on('data', b => { output += b; });
    const done = new Promise(resolve => child.on('exit', code => resolve(code)));
    try {
      await until(() => existsSync(join(dir, 'watchdog')));
      if (mode === 'suspend-parent') {
        await sleep(700); // several actual watchdog polls while parent cannot initialize anything
        assert.equal(loadState(dir)?.step, 'W0', 'state must predate watchdog spawn');
        const pid = Number(readFileSync(join(dir, 'watchdog')));
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0];
        assert.notEqual(stat, 'Z', 'supervisor stays alive across parent suspension');
        child.kill('SIGCONT');
        assert.equal(await done, 0, output);
      } else {
        assert.notEqual(await done, 0, output);
        assert.doesNotMatch(output, /A4_ACTION=fence/, 'startup failure cannot enter fence');
      }
    } finally {
      child.kill('SIGKILL');
      try { process.kill(Number(readFileSync(join(dir, 'watchdog'))), 'SIGKILL'); } catch {}
    }
  });
}
