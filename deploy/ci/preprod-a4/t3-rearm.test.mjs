import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rearm } from './t3-rearm.mjs';
import { runKubectl, saveState } from './t3-lib.mjs';
import { summarize } from './t3-chrono.mjs';
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

function makeRearmHarness({ jobs = ['pgbackup-a4-1', 'pgbackup-a4-2'], tier = 'restore', pvcDir = null } = {}) {
  const next = inputsForTier(tier), stateDir = mkdtempSync(join(tmpdir(), 't3-rearm-'));
  saveState(stateDir, { step: 'DONE', commitVerified: false, operationId: 'old' });
  const config = { ...next.config, request: { operationId: 'old' }, executionSha256: '0'.repeat(64),
    legacyImages: { api: 'legacy-api', 'auth-idp': 'legacy-idp', ui: 'legacy-ui' } };
  const originalPayload = Buffer.alloc(1024, 0x41);
  const originalArchive = gzipSync(originalPayload);
  const emptyArchive = gzipSync(Buffer.alloc(1024, 0x00));
  const cluster = { custodyEmpty: false, podExists: false, jobs: [...jobs], createdPods: [], pvcDir };
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
      if (cluster.pvcDir) {
        const out = execFileSync(process.execPath, ['-e', args.at(-1).replaceAll('/run/cm-cutover', cluster.pvcDir)], { encoding: 'utf8' });
        if (line.includes('fs.rmSync')) cluster.custodyEmpty = true;
        return out;
      }
      if (!line.includes('fs.rmSync')) return cluster.custodyEmpty ? '' : `F ${digest(originalPayload)} custody.bin\n`;
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
      if (!args.at(-1).includes('fs.rmSync')) return 'F ' + 'b'.repeat(64) + ' custody.bin\n';
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

for (const fault of ['before-wipe', 'partial-wipe', 'after-wipe-before-marker', 'delete-pod-after-wipe', 'between-jobs', 'after-state-rename']) {
  test(`R11 D3: rearm is resumable and idempotent across interruption (${fault})`, t => {
    const pvcDir = fault === 'partial-wipe' ? mkdtempSync(join(tmpdir(), 't3-rearm-part-')) : null;
    if (pvcDir) {
      mkdirSync(join(pvcDir, 'nested'));
      writeFileSync(join(pvcDir, 'receipt.json'), '{"committed":false}\n');
      writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'immutable-custody-bytes');
    }
    const h = makeRearmHarness({ pvcDir });
    t.after(() => {
      if (pvcDir) rmSync(pvcDir, { recursive: true, force: true });
      rmSync(h.stateDir, { recursive: true, force: true });
      rmSync(h.archive, { recursive: true, force: true });
    });
    let faulted = false;
    h.setFailOn((args, line) => {
      if (faulted) return false;
      if (fault === 'before-wipe' && line.includes('fs.rmSync')) { faulted = true; return true; }
      if (fault === 'partial-wipe' && line.includes('fs.rmSync')) { rmSync(join(pvcDir, 'receipt.json')); faulted = true; return true; }
      if (fault === 'after-wipe-before-marker' && line.includes('fs.rmSync')) { h.cluster.custodyEmpty = true; faulted = true; return true; }
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
      if (fault === 'after-wipe-before-marker' || fault === 'partial-wipe') assert.equal(existsSync(join(h.archive, '.custody-emptied')), false);
    }
    h.setFailOn(null);
    const resumed = h.run();
    assert.equal(resumed.archive, h.archive);
    assert.equal(digest(readFileSync(join(h.archive, 'custody.tar.gz'))), digest(h.originalArchive),
      'resumed rearm must never overwrite custody.tar.gz with the emptied PVC');
    assert.equal(readFileSync(join(h.archive, 'custody.sha256'), 'utf8').trim(), digest(h.originalArchive));
    assert.equal(h.cluster.custodyEmpty, true);
    if (pvcDir) assert.deepEqual(readdirSync(pvcDir), []);
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

test('R12 MIN-4: rearm through runKubectl routes chrono to archive without polluting new stateDir and passes second full replay', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-rearm-rk-'));
  const stateDir = join(dir, 'state'), archive = `${stateDir}-attempt-old`;
  const tarBytes = gzipSync(Buffer.alloc(1024, 0x42)), tarSha = digest(tarBytes);
  const next = inputs();
  const config = { ...next.config, request: { operationId: 'old' }, executionSha256: '0'.repeat(64),
    legacyImages: { api: 'legacy-api', 'auth-idp': 'legacy-idp', ui: 'legacy-ui' } };
  saveState(stateDir, { step: 'DONE', commitVerified: false, operationId: 'old' });
  const binFile = join(dir, 'kubectl');
  writeFileSync(binFile, `#!/usr/bin/env node
const fs = require('node:fs');
const a = process.argv.slice(2);
const i = a.indexOf('--request-timeout=60s');
const args = i >= 0 ? a.slice(i + 1) : a;
const stdin = args.includes('-i') ? fs.readFileSync(0, 'utf8') : '';
if (args[0] === 'exec' && stdin.includes('journal_present')) process.stdout.write('f|0');
else if (args[0] === 'get' && args[1] === 'deployment') {
  const n = args[2], img = ${JSON.stringify(config.legacyImages)}[n];
  process.stdout.write(JSON.stringify({ spec: { replicas: 1, template: { spec: { containers: [{ name: n, image: img }] } } }, status: { readyReplicas: 1 } }));
} else if (args[0] === 'get' && args[1] === 'jobs') process.stdout.write('{"items":[]}');
else if (args[0] === 'exec' && args.includes('sh')) process.stdout.write(${JSON.stringify(tarBytes.toString('base64'))});
else if (args[0] === 'exec' && args.includes('sha256sum')) process.stdout.write('${tarSha}  /tmp/t3-custody.tar.gz');
else if (args[0] === 'exec' && args.includes('node') && !args.at(-1).includes('fs.rmSync')) process.stdout.write('F ${'a'.repeat(64)} custody.bin\\n');
`, { mode: 0o755 });
  chmodSync(binFile, 0o755);
  const prevPath = process.env.PATH, prevState = process.env.T3_STATE_DIR, prevChrono = process.env.T3_CHRONO_FILE;
  process.env.PATH = `${dir}:${prevPath}`;
  process.env.T3_STATE_DIR = stateDir;
  delete process.env.T3_CHRONO_FILE;
  try {
    const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod' });
    const runOnce = () => rearm({ config, stateDir, call }, next.config, next.read);
    assert.equal(runOnce().archive, archive);
    assert.deepEqual(readdirSync(stateDir), [], 'fresh stateDir must stay empty after initial rearm');
    // Simulate after-state-rename interruption + resume + second full replay.
    rmSync(stateDir, { recursive: true, force: true });
    assert.equal(runOnce().archive, archive);
    assert.deepEqual(readdirSync(stateDir), [], 'resumed rearm must not pollute new stateDir with t3-chrono.jsonl');
    assert.equal(runOnce().archive, archive, 'first full replay after resume');
    assert.equal(runOnce().archive, archive, 'second full replay through runKubectl must succeed');
    assert.deepEqual(readdirSync(stateDir), [], 'second full replay must leave stateDir empty');
    const rearmChrono = join(archive, 'rearm-chrono.jsonl');
    assert.ok(existsSync(rearmChrono), 'rearm chrono routed into archive');
    assert.equal(summarize(readFileSync(rearmChrono, 'utf8')).pass, true);
  } finally {
    process.env.PATH = prevPath;
    if (prevState === undefined) delete process.env.T3_STATE_DIR; else process.env.T3_STATE_DIR = prevState;
    if (prevChrono === undefined) delete process.env.T3_CHRONO_FILE; else process.env.T3_CHRONO_FILE = prevChrono;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R12 MIN-5: resumed rearm re-verifies live PVC per-file manifest before emptying and refuses drifted PVC', () => {
  const pvcDir = mkdtempSync(join(tmpdir(), 't3-rearm-pvc-'));
  try {
    mkdirSync(join(pvcDir, 'nested'));
    writeFileSync(join(pvcDir, 'receipt.json'), '{"committed":false}\n');
    writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'immutable-custody-bytes');
    const h = makeRearmHarness({ jobs: [], pvcDir });
    let faulted = false;
    h.setFailOn((_args, line) => {
      if (!faulted && line.includes('fs.rmSync')) { faulted = true; return true; }
      return false;
    });
    assert.throws(() => h.run(), /injected_interrupt/);
    h.setFailOn(null);
    assert.ok(existsSync(join(h.archive, 'custody.manifest')), 'per-file manifest written at capture time');

    // Mutate live PVC file after capture: resume must refuse before emptying.
    writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'drifted-custody-bytes');
    assert.throws(() => h.run(), /rearm_custody_pvc_mismatch/);
    assert.equal(h.cluster.custodyEmpty, false);
    assert.ok(existsSync(join(pvcDir, 'receipt.json')), 'drifted PVC must not be wiped');

    // Add an unarchived file on PVC: resume must also refuse before emptying.
    writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'immutable-custody-bytes');
    writeFileSync(join(pvcDir, 'unarchived.txt'), 'new');
    assert.throws(() => h.run(), /rearm_custody_pvc_mismatch/);
    rmSync(join(pvcDir, 'unarchived.txt'));

    // Corrupt local archive while custody.sha256 exists: fails closed without purge or recapture.
    const goodTar = readFileSync(join(h.archive, 'custody.tar.gz'));
    writeFileSync(join(h.archive, 'custody.tar.gz'), 'corrupt');
    assert.throws(() => h.run(), /rearm_archive_invalid/);
    writeFileSync(join(h.archive, 'custody.tar.gz'), goodTar);

    // Restoring matching PVC and valid archive allows resume to verify and empty PVC cleanly.
    assert.equal(h.run().archive, h.archive);
    assert.deepEqual(readdirSync(pvcDir), []);
  } finally {
    rmSync(pvcDir, { recursive: true, force: true });
  }
});

test('R13 MAJOR-1: resumed rearm accepts partial/full wipe, refuses subset drift/addition, and enforces empty-PVC rule for manifest-less archives', t => {
  const pvcDir = mkdtempSync(join(tmpdir(), 't3-rearm-maj1-'));
  mkdirSync(join(pvcDir, 'nested'));
  writeFileSync(join(pvcDir, 'receipt.json'), '{"committed":false}\n');
  writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'immutable-custody-bytes');
  const h = makeRearmHarness({ pvcDir });
  const r11 = makeRearmHarness();
  t.after(() => {
    for (const p of [pvcDir, h.stateDir, h.archive, r11.stateDir, r11.archive]) rmSync(p, { recursive: true, force: true });
  });
  let faulted = false;
  h.setFailOn((_args, line) => {
    if (!faulted && line.includes('fs.rmSync')) { rmSync(join(pvcDir, 'receipt.json')); faulted = true; return true; }
    return false;
  });
  assert.throws(() => h.run(), /injected_interrupt/);
  h.setFailOn(null);

  // Drift on a remaining file after partial wipe is refused without wiping.
  writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'drifted-bytes');
  assert.throws(() => h.run(), /rearm_custody_pvc_mismatch/);
  assert.ok(existsSync(join(pvcDir, 'nested', 'witness.bin')));

  // New file added after partial wipe is refused without wiping.
  writeFileSync(join(pvcDir, 'nested', 'witness.bin'), 'immutable-custody-bytes');
  writeFileSync(join(pvcDir, 'extra.bin'), 'unexpected');
  assert.throws(() => h.run(), /rearm_custody_pvc_mismatch/);
  rmSync(join(pvcDir, 'extra.bin'));

  // Intact subset after partial wipe resumes and empties PVC cleanly.
  assert.equal(h.run().archive, h.archive);
  assert.deepEqual(readdirSync(pvcDir), []);

  // Pre-R12 archive without custody.manifest: refused with rearm_manifest_missing if live PVC is non-empty, accepted only when empty.
  mkdirSync(r11.archive, { recursive: true, mode: 0o700 });
  writeFileSync(join(r11.archive, 'custody.tar.gz'), r11.originalArchive, { mode: 0o600 });
  writeFileSync(join(r11.archive, 'custody.sha256'), `${digest(r11.originalArchive)}\n`, { mode: 0o600 });
  assert.throws(() => r11.run(), /rearm_manifest_missing/);
  assert.equal(r11.cluster.custodyEmpty, false);
  r11.cluster.custodyEmpty = true;
  assert.equal(r11.run().archive, r11.archive);
  assert.ok(existsSync(join(r11.archive, '.custody-emptied')));
  assert.deepEqual(r11.cluster.jobs, []);
  assert.equal(r11.run().archive, r11.archive, 'manifest-less archive replay after completion');
});
