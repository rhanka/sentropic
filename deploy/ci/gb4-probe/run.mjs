import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { access, liveInputs, controller } from './access.mjs';
import { manifests, namespace, name, clientPod } from './manifests.mjs';
import { report } from './report.mjs';

const root = process.env.GB4_REPO_ROOT || dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const flag = join(root, '.tmp/rv/gb4-probe-go.flag');
const mode = process.argv[2];
const pending = ['internet egress', 'metadata', 'kubernetes.default and other cluster services', 'DNS', 'no SA token', 'read-only root', 'only emptyDir storage writable', 'non-root UID', 'WebSocket from artifact-content', 'WebSocket from another pod', 'cleanup']
  .map((check) => ({ check, pass: null, evidence: 'awaiting conductor GO and live execution' }));
let resources = manifests();
if (mode === '--prepare') { report(root, resources, pending, 'PREPARED; no cluster access or mutation'); process.exit(0); }
if (!['--run', '--wait'].includes(mode)) throw new Error('expected --prepare, --run or --wait');
if (mode === '--wait') {
  const deadline = Date.now() + 10 * 60 * 60 * 1000;
  report(root, resources, pending, 'WAITING for conductor GO; polling every 120 seconds, at most 10 hours');
  while (!existsSync(flag) && Date.now() < deadline) {
    console.log(`${new Date().toISOString()} waiting for conductor GO`);
    await delay(Math.min(120000, deadline - Date.now()));
  }
  if (!existsSync(flag)) {
    report(root, resources, [{ check: 'conductor GO within 10 hours', pass: false, evidence: 'deadline reached; no cluster access or mutation' }, ...pending], 'FAIL: GO timeout');
    process.exit(1);
  }
}
// This gate precedes even credential loading and read-only cluster discovery.
if (!existsSync(flag)) { console.error('Conductor GO file absent; no cluster access or mutation'); process.exit(2); }
const rows = [{ check: 'WebSocket from artifact-content', pass: null, result: 'PENDING-EGRESS', evidence: 'artifact-content egress is not deployed; no policy mutation authorized for this run' }];
let connection;
const created = [];
const record = (check, pass, evidence) => rows.push({ check, pass, evidence });
try {
  connection = access(root);
  const { kube } = connection;
  const inputs = liveInputs(connection.discover);
  resources = manifests(inputs.targets);
  const identity = JSON.parse(kube(['auth', 'whoami', '-o', 'json'])).status.userInfo.username;
  if (identity !== controller) throw new Error('controller identity mismatch');
  record('controller identity', true, identity);
  report(root, resources, pending, 'GO received; preprod inputs verified');
  record('live service prerequisites', true, inputs.targets.map(([svc, ip, port]) => `${svc}=${ip}:${port} has ready endpoints`).join('; '));
  for (const r of resources) {
    if (kube(['get', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '-o', 'name'])) throw new Error('probe name collision; existing resource left untouched');
    kube(['create', '--dry-run=server', '-f', '-'], JSON.stringify(r));
  }
  if (!existsSync(flag)) throw new Error('conductor GO withdrawn before mutation');
  const create = (r) => { created.push(r); kube(['create', '-f', '-'], JSON.stringify(r)); };
  for (const r of resources) create(r);
  kube(['wait', '-n', namespace, '--for=condition=Ready', `pod/${name}`, '--timeout=90s']);
  const logResult = async (pod, type) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const lines = kube(['logs', '-n', namespace, pod, '-c', 'probe', '--pod-running-timeout=10s']);
      const result = lines.split('\n').filter(Boolean).map((line) => JSON.parse(line)).find((r) => r.type === type);
      if (result) return result;
      await delay(1000);
    }
    throw new Error(`missing ${type} in ${pod} logs`);
  };
  const result = await logResult(name, 'GB4_SELF_TEST');
  if (!Array.isArray(result.rows) || !result.rows.length) throw new Error('invalid self-test response');
  rows.push(...result.rows);
  const control = await logResult(name, 'GB4_WEBSOCKET');
  record('WebSocket loopback positive control', control.result === 'ECHO_OK', JSON.stringify(control));
  const podIP = kube(['get', 'pod', name, '-n', namespace, '-o', 'jsonpath={.status.podIP}']);
  if (!podIP) throw new Error('probe Pod IP absent');
  for (const [suffix, destination] of [['dns', `${name}.${namespace}.svc.cluster.local`], ['ip', podIP]]) {
    const client = clientPod(destination);
    client.metadata.name += `-${suffix}`;
    resources.push(client);
    if (kube(['get', 'pod', client.metadata.name, '-n', namespace, '--ignore-not-found', '-o', 'name'])) throw new Error('negative-client name collision');
    kube(['create', '--dry-run=server', '-f', '-'], JSON.stringify(client));
    create(client);
    kube(['wait', '-n', namespace, '--for=jsonpath={.status.phase}=Succeeded', `pod/${client.metadata.name}`, '--timeout=60s']);
    const response = await logResult(client.metadata.name, 'GB4_WEBSOCKET');
    record(`WebSocket blocked from another pod (${suffix})`, response.result.startsWith('BLOCKED_'), `${client.metadata.name} to ${destination}: ${JSON.stringify(response)}`);
  }
} catch (error) {
  record('probe execution', false, error.message);
} finally {
  if (created.length && connection) {
    for (const r of [...created].reverse()) {
      try {
        connection.kube(['delete', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '--wait=true', '--timeout=60s']);
        const remains = connection.kube(['get', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '-o', 'name']);
        record(`cleanup ${r.kind}/${r.metadata.name}`, !remains, remains || 'verified absent');
      } catch (error) { record(`cleanup ${r.kind}/${r.metadata.name}`, false, error.message); }
    }
  } else record('cleanup', true, 'no resources created');
  connection?.close();
  const passed = rows.every((row) => row.pass === true || row.result === 'PENDING-EGRESS');
  const status = passed ? 'PASS for executed checks; PENDING-EGRESS for artifact-content WebSocket' : 'FAIL';
  report(root, resources, rows, status);
  console.log(`GB4 ${status}: ${join(root, '.tmp/rv/gb4-probe.md')}`);
  process.exitCode = passed ? 0 : 1;
}
