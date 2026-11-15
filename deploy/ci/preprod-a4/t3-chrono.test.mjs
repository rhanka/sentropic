import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chrono, chronoSince, chronoStart, kubectlClass, summarize } from './t3-chrono.mjs';
import { kubectl } from './guards.mjs';
import { runKubectl } from './t3-lib.mjs';
import { ops } from './ops.mjs';
import { execute } from './execution.mjs';
import { approvedRequest, commit, image, sha } from './fixtures.mjs';
import { digest } from './guards.mjs';

const here = new URL('.', import.meta.url);
const records = file => readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
function sandbox(run) {
  const dir = mkdtempSync(join(tmpdir(), 't3-chrono-')), file = join(dir, 'chrono.jsonl');
  const saved = { path: process.env.PATH, file: process.env.T3_CHRONO_FILE };
  writeFileSync(join(dir, 'kubectl'), '#!/bin/sh\nexit 0\n'); chmodSync(join(dir, 'kubectl'), 0o755);
  process.env.PATH = `${dir}:${saved.path}`; process.env.T3_CHRONO_FILE = file;
  try { return run(file, dir); } finally {
    process.env.PATH = saved.path;
    if (saved.file === undefined) delete process.env.T3_CHRONO_FILE; else process.env.T3_CHRONO_FILE = saved.file;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('chronometer keeps sub-second resolution and writes protected JSON lines', () => sandbox(file => {
  const record = chrono('custodyDetach', chronoStart() - 6_250_400_000n, { status: 0 });
  assert.ok(record.elapsedMs >= 6250.4 && record.elapsedMs < 6300, `${record.elapsedMs}`);
  assert.notEqual(record.elapsedMs, Math.round(record.elapsedMs / 1000) * 1000);
  assert.ok(chrono('step:W4', chronoSince(52_340), {}, {}).elapsedMs >= 52_340);
  assert.ok(chrono('step:W4', chronoSince(Number.NaN), {}, {}).elapsedMs < 1000, 'a malformed span never throws');
  assert.deepEqual(records(file), [record]);
  assert.equal(Number.isInteger(record.atMonoMs), true);
}));

test('every kubectl round trip of both runners is timed without secret arguments', () => sandbox((file, dir) => {
  kubectl('/private/kube', ['get', 'deployment', 'api', '-o', 'json'], undefined, 'sentropic-restore-a4');
  runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-restore-a4', stateDir: dir })(
    ['patch', 'secret', 'sentropic-api', '--type=merge', '--patch-file=/private/patch']);
  const [first, second] = records(file);
  assert.deepEqual([first.name, first.command, first.status], ['kubectlRoundTrip', 'get deployment api', 0]);
  assert.deepEqual([second.name, second.command], ['kubectlRoundTrip', 'patch secret sentropic-api']);
  assert.doesNotMatch(readFileSync(file, 'utf8'), /private/);
  assert.equal(kubectlClass(['delete', 'pod', 'sentropic-a4-custodian', '--wait=true', '--timeout=180s']), 'kubectlWait');
  assert.equal(kubectlClass(['exec', '-i', 'postgres-0']), 'kubectlExec');
}));

test('custody attach and detach are named measures judged against the M-1 thresholds', () => sandbox(file => {
  const request = { ...approvedRequest, namespace: 'sentropic-preprod', candidateCommit: commit, candidateImage: image,
    operationId: 'a4', backupTemplateSha256: sha, remoteSnapshotDigest: digest('{}') };
  const env = { A4_TIER: 'preprod', A4_KUBECONFIG_FILE: '/private/kube', A4_REQUEST_FILE: '/private/request', A4_DRY_RUN: '0' };
  const annex = JSON.stringify({ format: 'preprod-a4-execution/1', namespace: 'sentropic-preprod',
    authorizationRef: request.authorizationRef, operationId: 'a4', candidateCommit: commit, candidateImage: image,
    actions: { 'delete-custodian': [['delete', 'pod', 'sentropic-a4-custodian', '--wait=true', '--timeout=180s']] } });
  const read = path => path === '/private/request' ? JSON.stringify(request) : path === '/private/annex' ? annex : 'private';
  execute({ ...env, A4_ACTION: 'delete-custodian', A4_EXECUTION_FILE: '/private/annex', A4_EXECUTION_SHA256: digest(annex) },
    () => '', read);
  const template = { spec: { affinity: { podAffinity: { preferredDuringSchedulingIgnoredDuringExecution: [{ weight: 100,
    podAffinityTerm: { topologyKey: 'kubernetes.io/hostname', labelSelector: { matchLabels: { 'app.kubernetes.io/component': 'postgres' } } } }] } },
    containers: [{ name: 'api', command: ['node', '/run/cm-runtime/launch.mjs'], env: [], envFrom: [],
      volumeMounts: [{ name: 'cm-cutover', mountPath: '/run/cm-cutover', readOnly: true }] }],
    volumes: [{ name: 'cm-runtime', configMap: { name: 'sentropic-a4-runtime' } },
      { name: 'cm-cutover', persistentVolumeClaim: { claimName: 'sentropic-a4-custody', readOnly: true } }] } };
  ops({ ...env, A4_OPERATION: 'custodian' }, (_config, args) => args[1] === 'deployment'
    ? JSON.stringify({ spec: { replicas: 0, template } })
    : JSON.stringify({ items: [{ metadata: {}, spec: { nodeName: 'node-a' }, status: { phase: 'Running' } }] }), read);
  assert.deepEqual(records(file).map(record => record.name), ['custodyDetach', 'custodyAttach']);
  const summary = summarize(`${readFileSync(file, 'utf8')}{"name":"custodyAttach","elapsedMs":21000.5}\n`);
  assert.deepEqual(summary.groups.custodyAttach, { count: 2, maxMs: 21000.5, thresholdMs: 10000, pass: false });
  assert.equal(summary.groups.custodyDetach.pass, true); assert.equal(summary.pass, false);
}));

test('operator targets and the human emergency command force the C numeric locale', () => {
  const targets = readFileSync(new URL('targets.mk', here), 'utf8');
  for (const pattern of ['k8s-t3-%', 'k8s-restore-a4-%', 'k8s-preprod-a4-%', 'k8s-prod-a4-%']) {
    assert.match(targets, new RegExp(`^${pattern.replace('%', '%')}[^\\n]*: export override LC_ALL := C$`, 'm'), pattern);
    assert.match(targets, new RegExp(`^${pattern}[^\\n]*: export override LC_NUMERIC := C$`, 'm'), pattern);
  }
  assert.match(readFileSync(new URL('t3-emergency.sh', here), 'utf8'), /^LC_ALL=C LC_NUMERIC=C; export LC_ALL LC_NUMERIC$/m);
});
