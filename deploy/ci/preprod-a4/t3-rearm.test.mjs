import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rearm } from './t3-rearm.mjs';
import { saveState } from './t3-lib.mjs';
import { inputs } from './t3-preflight.test.mjs';
import { gzipSync } from 'node:zlib';
import { canonical, digest } from './guards.mjs';

function inputsForTier(tier = 'preprod') {
  if (tier === 'preprod') return inputs();
  const ns = tier === 'restore' ? 'sentropic-restore-a4' : 'sentropic';
  const f = inputs(tier === 'restore' ? 'https://app.restore-a4.test/api/v1/me' : undefined);
  f.config.tier = tier; f.config.namespace = ns;
  f.config.request = { ...f.config.request, format: 'prod-a4-request/1', namespace: 'sentropic',
    emailCodeActiveKeyRef: 'email-code-hmac:v1:prod:15c2f8b66073655a' };
  for (const path of ['/authorization', '/rehearsal']) {
    const value = JSON.parse(f.files[path]); value.format = value.format.replace('preprod-', 'prod-');
    if (value.namespace) value.namespace = 'sentropic'; f.files[path] = JSON.stringify(value);
  }
  f.files['/postgres-version'] = JSON.stringify({ ...JSON.parse(f.files['/postgres-version']), namespace: ns });
  f.config.applicabilityReceiptPolicy.originalRehearsalSha256 = digest(f.files['/rehearsal']);
  const annex = JSON.parse(f.files['/annex'].replaceAll('sentropic-preprod-a4-verification', `${ns}-a4-verification`));
  annex.format = 'prod-a4-execution/1'; annex.namespace = 'sentropic';
  annex.applicabilityReceiptPolicySha256 = digest(canonical(f.config.applicabilityReceiptPolicy));
  f.files['/annex'] = JSON.stringify(annex); f.config.executionSha256 = digest(f.files['/annex']);
  if (tier === 'restore') {
    const iso = u => { const url = new URL(u); url.hostname = url.hostname.startsWith('idp.') ? 'auth.restore-a4.test' : 'app.restore-a4.test'; return url.href; };
    for (const k of Object.keys(f.config.endpoints)) f.config.endpoints[k] = iso(f.config.endpoints[k]);
    for (const p of [...f.config.externalProbes, ...f.config.restrictedProbes]) p.url = iso(p.url);
  }
  return f;
}

function makeRearmHarness({ jobs = ['pgbackup-a4-1', 'pgbackup-a4-2'], tier = 'restore' } = {}) {
  const next = inputsForTier(tier), stateDir = mkdtempSync(join(tmpdir(), 't3-rearm-'));
  saveState(stateDir, { step: 'DONE', commitVerified: false, operationId: 'old' });
  const config = { ...next.config, request: { operationId: 'old' }, executionSha256: '0'.repeat(64),
    legacyImages: { api: 'legacy-api', 'auth-idp': 'legacy-idp', ui: 'legacy-ui' } };
  const originalPayload = Buffer.alloc(1024, 0x41);
  const originalArchive = gzipSync(originalPayload);
  const emptyArchive = gzipSync(Buffer.alloc(1024, 0x00));
  const cluster = { custodyEmpty: false, podExists: false, jobs: [...jobs], createdPods: [] };
  const calls = [];
  let failOn = null;
  const makeCall = () => (args, input) => {
    const line = args.join(' ');
    calls.push(line);
    if (failOn?.(args, line, input)) throw new Error(`injected_interrupt: ${line}`);
    if (args[0] === 'create' && args[1] === '-f') {
      if (cluster.podExists) throw new Error('AlreadyExists: pods "sentropic-a4-rearm" already exists');
      const pod = JSON.parse(input);
      cluster.podExists = true;
      cluster.createdPods.push(pod);
      return '';
    }
    if (line.startsWith('delete pod sentropic-a4-rearm')) {
      cluster.podExists = false;
      return '';
    }
    if (args[0] === 'delete' && args[1] === 'job') {
      cluster.jobs = cluster.jobs.filter(name => name !== args[2]);
      return '';
    }
    if (args[0] === 'exec' && String(input).includes('journal_present')) return 'f|0';
    if (args[0] === 'exec' && args.includes('sh')) {
      return (cluster.custodyEmpty ? emptyArchive : originalArchive).toString('base64');
    }
    if (args[0] === 'exec' && args.includes('sha256sum')) {
      const current = cluster.custodyEmpty ? emptyArchive : originalArchive;
      return `${digest(current)}  /tmp/t3-custody.tar.gz`;
    }
    if (args[0] === 'exec' && args.includes('node')) {
      cluster.custodyEmpty = true;
      return '';
    }
    if (args[0] === 'get' && args[1] === 'deployment') {
      const name = args[2];
      return JSON.stringify({ spec: { replicas: 1, template: { spec: {
        containers: [{ name, image: config.legacyImages[name] }] } } }, status: { readyReplicas: 1 } });
    }
    if (args[0] === 'get' && args[1] === 'jobs') {
      return JSON.stringify({ items: cluster.jobs.map(name => ({ metadata: { name }, status: { succeeded: 1 } })) });
    }
    return '';
  };
  return { next, stateDir, archive: `${stateDir}-attempt-old`, config, calls, cluster,
    originalArchive, setFailOn: fn => { failOn = fn; }, run: () => rearm({ config, stateDir, call: makeCall() }, next.config, next.read) };
}

for (const mode of ['success','tar-error','corrupt-transfer','wrong-hash']) test(`rearm archives safely: ${mode}`, () => {
  const next = inputs(), stateDir = mkdtempSync(join(tmpdir(),'t3-rearm-'));
  saveState(stateDir,{ step: 'DONE', commitVerified: false, operationId: 'old' });
  const config = { ...next.config, request: { operationId: 'old' }, executionSha256: '0'.repeat(64),
    legacyImages: { api: 'legacy-api', 'auth-idp': 'legacy-idp', ui: 'legacy-ui' } };
  const calls = [];
  const archiveBytes = gzipSync(Buffer.alloc(1024));
  const archive = `${stateDir}-attempt-old`;
  const call = (args,input) => {
    calls.push(args.join(' '));
    if (args[0] === 'exec' && String(input).includes('journal_present')) return 'f|0';
    if (args[0] === 'exec' && args.includes('node')) {
      assert.ok(existsSync(join(archive,'custody.tar.gz')), 'archive exists before erasure');
      assert.match(readFileSync(join(archive,'custody.sha256'),'utf8'),/^[a-f0-9]{64}$/);
      return '';
    }
    if (args[0] === 'exec' && args.includes('sh')) {
      if (mode === 'tar-error') throw new Error('tar failed after partial output');
      return (mode === 'corrupt-transfer' ? Buffer.from('partial') : archiveBytes).toString('base64');
    }
    if (args[0] === 'exec' && args.includes('sha256sum')) return `${mode === 'wrong-hash' ? '0'.repeat(64) : digest(archiveBytes)}  /tmp/t3-custody.tar.gz`;
    if (args[0] === 'get' && args[1] === 'deployment') {
      const name = args[2];
      return JSON.stringify({ spec: { replicas: 1, template: { spec: {
        containers: [{ name, image: config.legacyImages[name] }] } } }, status: { readyReplicas: 1 } });
    }
    if (args[0] === 'get' && args[1] === 'jobs') return '{"items":[]}';
    return '';
  };
  if (mode !== 'success') {
    assert.throws(() => rearm({ config,stateDir,call },next.config,next.read));
    assert.ok(!calls.some(c => c.includes('fs.rmSync')),'failed archive must never erase custody');
    assert.ok(existsSync(join(stateDir,'t3-window-state.json')),'original evidence preserved');
    return;
  }
  const result = rearm({ config,stateDir,call },next.config,next.read);
  assert.equal(result.archive,archive);
  assert.ok(existsSync(join(archive,'operator-state','t3-window-state.json')));
  assert.ok(existsSync(stateDir));
  assert.ok(calls.some(c => c.startsWith('delete pod sentropic-a4-rearm')));
});

test('R11 D3: sentropic-a4-rearm pod sets priorityClassName, 1s grace, SIGTERM exit 0 and keeps 30s delete timeout', async () => {
  const h = makeRearmHarness({ jobs: [] });
  h.run();
  assert.equal(h.cluster.createdPods.length, 1);
  const [pod] = h.cluster.createdPods;
  assert.equal(pod.spec.terminationGracePeriodSeconds, 1);
  assert.equal(pod.spec.priorityClassName, 'sentropic-t3-critical');
  assert.ok(h.calls.includes('delete pod sentropic-a4-rearm --ignore-not-found=true --wait=true --timeout=30s'));
  assert.ok(!h.calls.some(c => c.includes('--timeout=60s')));
  const cmd = pod.spec.containers[0].command;
  assert.equal(cmd[0], 'node');
  const child = spawn(process.execPath, cmd.slice(1), { stdio: 'ignore' });
  await new Promise(resolve => setTimeout(resolve, 80));
  const t0 = performance.now();
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, elapsedMs: performance.now() - t0 }));
  });
  child.kill('SIGTERM');
  const res = await exited;
  assert.equal(res.code, 0, 'PID 1 command must catch SIGTERM and exit 0');
  assert.equal(res.signal, null);
  assert.ok(res.elapsedMs < 500, `SIGTERM exit took ${res.elapsedMs}ms`);
});

for (const fault of ['before-wipe', 'delete-pod-after-wipe', 'between-jobs', 'after-state-rename']) {
  test(`R11 D3: rearm is resumable and idempotent across interruption (${fault})`, () => {
    const h = makeRearmHarness();
    let faulted = false;
    h.setFailOn((args, line) => {
      if (faulted) return false;
      if (fault === 'before-wipe' && args[0] === 'exec' && args.includes('node')) { faulted = true; return true; }
      if (fault === 'delete-pod-after-wipe' && line.startsWith('delete pod sentropic-a4-rearm') && h.cluster.custodyEmpty) {
        faulted = true; return true;
      }
      if (fault === 'between-jobs' && line.startsWith('delete job pgbackup-a4-2')) { faulted = true; return true; }
      return false;
    });
    if (fault === 'after-state-rename') {
      h.run();
      rmSync(h.stateDir, { recursive: true, force: true });
    } else {
      assert.throws(() => h.run(), /injected_interrupt/);
    }
    h.setFailOn(null);
    const resumed = h.run();
    assert.equal(resumed.archive, h.archive);
    assert.equal(digest(readFileSync(join(h.archive, 'custody.tar.gz'))), digest(h.originalArchive),
      'resumed rearm must never overwrite custody.tar.gz with the emptied PVC');
    assert.equal(readFileSync(join(h.archive, 'custody.sha256'), 'utf8').trim(), digest(h.originalArchive));
    assert.equal(h.cluster.custodyEmpty, true);
    assert.equal(h.cluster.podExists, false);
    assert.deepEqual(h.cluster.jobs, []);
    assert.ok(existsSync(join(h.archive, 'operator-state', 't3-window-state.json')));
    assert.ok(existsSync(h.stateDir));

    // Full idempotent replay after completion also succeeds without overwriting archive or creating a new pod.
    const podsBeforeReplay = h.cluster.createdPods.length;
    const replay = h.run();
    assert.equal(replay.archive, h.archive);
    assert.equal(h.cluster.createdPods.length, podsBeforeReplay);
    assert.equal(digest(readFileSync(join(h.archive, 'custody.tar.gz'))), digest(h.originalArchive));

    // A non-empty new stateDir colliding with an already archived operationId is still refused.
    writeFileSync(join(h.stateDir, 't3-window-state.json'), JSON.stringify({ step: 'DONE', commitVerified: false, operationId: 'old' }));
    assert.throws(() => h.run(), /rearm_archive_exists/);
  });
}

test('R12 MIN-9: rearm pod sets priorityClassName on prod and restore tiers only, aligned with prioritized(tier)', () => {
  for (const [tier, expected] of [['preprod', undefined], ['prod', 'sentropic-t3-critical'], ['restore', 'sentropic-t3-critical']]) {
    const h = makeRearmHarness({ jobs: [], tier });
    h.run();
    assert.equal(h.cluster.createdPods.length, 1);
    assert.equal(h.cluster.createdPods[0].spec.priorityClassName, expected, `unexpected priorityClassName for tier=${tier}`);
  }
});
