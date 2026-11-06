import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { manifests, serverSource, clientSource, image } from './manifests.mjs';

test('should refuse live execution without GO before loading credentials', () => {
  const root = mkdtempSync(join(tmpdir(), 'gb4-gate-'));
  try {
    const result = spawnSync(process.execPath, ['deploy/ci/gb4-probe/run.mjs', '--run'], { env: { ...process.env, GB4_REPO_ROOT: root }, encoding: 'utf8' });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /GO file absent/);
    assert.equal(existsSync(join(root, '.tmp/rv/gb4-probe.md')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('should render a restricted digest-pinned Pod with only emptyDir storage', () => {
  const [pod, service, policy] = manifests([['live-service', '10.0.0.1', 443]]);
  assert.match(image, /^docker.io\/library\/node@sha256:[a-f0-9]{64}$/);
  assert.equal(pod.spec.automountServiceAccountToken, false);
  assert.equal(pod.spec.serviceAccountName, 'artifact-builder');
  assert.ok(pod.metadata.labels['sentropic.dev/artifact-binding']);
  assert.ok(pod.spec.activeDeadlineSeconds > 0 && pod.spec.activeDeadlineSeconds <= 3600);
  assert.ok(pod.spec.volumes.every((v) => Object.keys(v).sort().join(',') === 'emptyDir,name'));
  const c = pod.spec.containers[0];
  assert.deepEqual(c.securityContext.capabilities.drop, ['ALL']);
  assert.equal(c.securityContext.readOnlyRootFilesystem, true);
  assert.equal(c.securityContext.allowPrivilegeEscalation, false);
  assert.equal(pod.spec.securityContext.runAsNonRoot, true);
  assert.equal(pod.spec.securityContext.seccompProfile.type, 'RuntimeDefault');
  assert.equal(c.envFrom, undefined);
  assert.ok(c.env.every((env) => !env.valueFrom));
  assert.equal(service.spec.type, 'ClusterIP');
  assert.deepEqual(service.spec.selector, pod.metadata.labels);
  assert.equal(policy.spec.egress[0].to.length, 1);
  assert.equal(policy.spec.egress[0].to[0].namespaceSelector.matchLabels['kubernetes.io/metadata.name'], pod.metadata.namespace);
  assert.equal(policy.spec.egress[0].ports[0].port, 5173);
});

test('should echo a split masked WebSocket frame and detect reachable egress', async () => {
  const server = spawn(process.execPath, ['--input-type=module', '-e', serverSource()], {
    env: { ...process.env, GB4_CLUSTER_TARGETS: JSON.stringify([['reachable-control', '127.0.0.1', 5173]]) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let diagnostics = '';
  server.stderr.on('data', (data) => { diagnostics += data; });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { ready = (await fetch('http://127.0.0.1:5173/healthz')).ok; } catch { /* Server starting. */ }
      if (ready) break;
      await delay(20);
    }
    assert.ok(ready, diagnostics);
    const client = spawnSync(process.execPath, ['--input-type=module', '-e', clientSource(), '127.0.0.1'], { encoding: 'utf8' });
    assert.equal(client.status, 0, client.stderr);
    assert.equal(JSON.parse(client.stdout).result, 'ECHO_OK');
    const response = await fetch('http://127.0.0.1:5173/self-test');
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.pass, false);
    assert.equal(result.rows.find((r) => r.check === 'reachable-control blocked').pass, false);
    for (const check of ['non-root UID', 'no SA token', 'root filesystem read-only', 'only emptyDir storage writable']) {
      const row = result.rows.find((r) => r.check === check);
      assert.equal(row?.pass, true, JSON.stringify(row));
    }
    assert.ok(result.rows.filter((r) => r.check.startsWith('emptyDir writable:')).every((r) => r.pass));
  } finally { server.kill('SIGTERM'); await new Promise((resolve) => server.once('exit', resolve)); }
});
