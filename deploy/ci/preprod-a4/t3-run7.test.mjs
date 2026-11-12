import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadState, monoMs, saveState } from './t3-lib.mjs';
import { poll } from './t3-watchdog.mjs';
import { buildProbes } from './t3-lib.mjs';
import { drive } from './t3-window-driver.mjs';
import { finishOpen } from './t3-finish-open.mjs';

const here = new URL('.', import.meta.url).pathname;
const endpoints = Object.fromEntries(['appHealth', 'idpConfig', 'idpJwks', 's6Authorize', 'appMe', 'idpMe', 'emailApp', 'emailIdp']
  .map(name => [name, `https://idp.test/${name}`]));

test('RUN7 missing mandatory probes refuses before the fence or any state write', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-missing-probes-'));
  await assert.rejects(drive({ stateDir: dir, config: {}, call: () => assert.fail('Kubernetes called'),
    delivered: () => assert.fail('fence called') }), /mandatory_probes_missing/);
  assert.equal(loadState(dir), null);
  await assert.rejects(finishOpen({ state: {}, probes: [], call: () => assert.fail('Kubernetes called') }), /mandatory_probes_missing/);
});

for (const location of ['https://client.test/callback?error=invalid_scope',
  'https://client.test/callback?error=invalid_target', '/auth/login?error=invalid_scope', '',
  'https://evil.test/auth/login?continue=ok', '/auth/login?continue=ok']) {
  test(`RUN7 S-6 accepts only the error-free login redirect: ${location}`, async () => {
    const state = { namespace: 'sentropic-preprod', middlewareSpec: {} };
    const writes = [];
    const ctx = { state, images: { candidate: 'c', ui: 'u' }, ...buildProbes({ endpoints }), save: () => {},
      call: args => {
        const cmd = args.join(' ');
        if (cmd.includes('get deployment')) {
          const name = args[2];
          return JSON.stringify({ spec: { replicas: 1, template: { spec: { containers: [{ name, image: name === 'ui' ? 'u' : 'c' }] } } },
            status: { readyReplicas: 1, observedGeneration: 1 }, metadata: { generation: 1 } });
        }
        if (cmd.includes('get middleware')) return '{"spec":{}}';
        if (cmd.includes('get ingress')) return JSON.stringify({ metadata: { annotations: {
          'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } } });
        writes.push(cmd); return '{}';
      }, probe: async url => ({ status: url.endsWith('s6Authorize') ? 302 : url.endsWith('Me') ? 401 : 200,
        headers: new Headers({ location }), body: { cancel: async () => {} } }) };
    if (location === '/auth/login?continue=ok') await finishOpen(ctx);
    else {
      await assert.rejects(finishOpen(ctx), /probe_failed: S-6/);
      assert.equal(state.substate, undefined);
      assert.equal(writes.length, 0, 'failed OAuth proof must leave traffic restricted');
    }
  });
}
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

for (const entry of ['emergency', 'classify', 'rollback', 'finish-open']) {
  test(`RUN7 ${entry} CLI enforces one deadline under injected kubectl latency`, () => {
    const dir = mkdtempSync(join(tmpdir(), 't3-deadline-'));
    const config = join(dir, 'config.json');
    writeFileSync(config, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod',
      endpoints, images: { candidate: 'c', ui: 'u' }, middlewareSpec: { ipAllowList: { sourceRange: ['1.1.1.1/32'] } } }));
    saveState(dir, { step: 'W3', t0MonoMs: monoMs() - 299_500 });
    writeFileSync(join(dir, 'kubectl'), '#!/bin/sh\nsleep 0.3\necho \'{"items":[],"spec":{"suspend":true}}\'\n', { mode: 0o700 });
    const args = entry === 'emergency' ? ['sh', [`${here}t3-emergency.sh`, '--config', config, '--state-dir', dir]]
      : [process.execPath, [`${here}t3-${entry === 'classify' ? 'emergency-classify' : entry}.mjs`,
        ...(entry === 'finish-open' ? ['--config', config, '--state-dir', dir] : ['--kubeconfig-file', '/private/kube'])]];
    const started = performance.now();
    const out = spawnSync(...args, { encoding: 'utf8', timeout: 4000,
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, T3_DEADLINE_MONO_MS: String(monoMs() + 500) } });
    assert.ok(performance.now() - started < 1800, `${entry} outlived shared 500 ms budget: ${out.stderr}`);
    assert.notEqual(out.status, 0);
  });
}

test('RUN7 expired human emergency refuses before any Kubernetes command', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-expired-'));
  const config = join(dir, 'config.json');
  writeFileSync(config, '{}');
  saveState(dir, { step: 'W3', t0MonoMs: monoMs() - 300_000 });
  writeFileSync(join(dir, 'kubectl'), '#!/bin/sh\necho forbidden > "$T3_STATE_DIR/writes"\n', { mode: 0o700 });
  const out = spawnSync('sh', [`${here}t3-emergency.sh`, '--config', config, '--state-dir', dir],
    { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /budget_exhausted/);
  assert.throws(() => readFileSync(join(dir, 'writes')));
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
