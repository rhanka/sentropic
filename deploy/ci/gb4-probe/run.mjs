import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { access, liveInputs, preprod } from './access.mjs';
import { manifests, namespace, name, clientSource } from './manifests.mjs';
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
const rows = [];
let connection, mutated = false;
const record = (check, pass, evidence) => rows.push({ check, pass, evidence });
try {
  connection = access(root);
  const { kube } = connection;
  const inputs = liveInputs(kube);
  resources = manifests(inputs.targets);
  report(root, resources, pending, 'GO received; preprod inputs verified');
  record('live service prerequisites', true, inputs.targets.map(([svc, ip, port]) => `${svc}=${ip}:${port} has ready endpoints`).join('; '));
  for (const r of resources) {
    if (kube(['get', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '-o', 'name'])) throw new Error('probe name collision; existing resource left untouched');
    kube(['apply', '--dry-run=server', '-f', '-'], JSON.stringify(r));
  }
  if (!existsSync(flag)) throw new Error('conductor GO withdrawn before mutation');
  mutated = true;
  for (const r of resources) kube(['apply', '-f', '-'], JSON.stringify(r));
  kube(['wait', '-n', namespace, '--for=condition=Ready', `pod/${name}`, '--timeout=90s']);
  const readSelfTest = "fetch('http://127.0.0.1:5173/self-test').then(r=>{if(!r.ok)throw Error();return r.text()}).then(console.log).catch(()=>process.exit(1))";
  const result = JSON.parse(kube(['exec', '-n', namespace, name, '-c', 'probe', '--', 'node', '-e', readSelfTest]));
  if (!Array.isArray(result.rows) || !result.rows.length) throw new Error('invalid self-test response');
  rows.push(...result.rows);
  const podIP = kube(['get', 'pod', name, '-n', namespace, '-o', 'jsonpath={.status.podIP}']);
  if (!podIP) throw new Error('probe Pod IP absent');
  for (const [source, expected] of [[inputs.allowed, true], [inputs.forbidden, false]]) {
    for (const destination of [`${name}.${namespace}.svc.cluster.local`, podIP]) {
      const response = JSON.parse(kube(['exec', '-n', preprod, source.metadata.name, '-c', inputs.container(source), '--', 'node', '--input-type=module', '-e', clientSource(), destination]));
      record(`WebSocket ${expected ? 'allowed' : 'blocked'} from ${source.metadata.name} to ${destination}`, expected ? response.result === 'ECHO_OK' : response.result.startsWith('BLOCKED_'), JSON.stringify(response));
    }
  }
} catch (error) {
  record('probe execution', false, error.message);
} finally {
  if (mutated && connection) {
    for (const r of [...resources].reverse()) {
      try {
        connection.kube(['delete', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '--wait=true', '--timeout=60s']);
        const remains = connection.kube(['get', r.kind, r.metadata.name, '-n', r.metadata.namespace, '--ignore-not-found', '-o', 'name']);
        record(`cleanup ${r.kind}/${r.metadata.name}`, !remains, remains || 'verified absent');
      } catch (error) { record(`cleanup ${r.kind}/${r.metadata.name}`, false, error.message); }
    }
  } else record('cleanup', true, 'no resources created');
  connection?.close();
  const passed = rows.every((row) => row.pass);
  report(root, resources, rows, passed ? 'PASS' : 'FAIL');
  console.log(`GB4 ${passed ? 'PASS' : 'FAIL'}: ${join(root, '.tmp/rv/gb4-probe.md')}`);
  process.exitCode = passed ? 0 : 1;
}
