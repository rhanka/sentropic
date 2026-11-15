import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { finishOpen } from './t3-finish-open.mjs';
import { buildProbes, loadState, runKubectl } from './t3-lib.mjs';
import { templateDigest } from './t3-rollback.mjs';
import { drive } from './t3-window-driver.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
import { witnessBinding } from './t3-applicability.mjs';
import { rehearsalFixture } from './t3-rehearsal-fixture.mjs';
import { PROD_POSTGRES_IMAGE, PROD_POSTGRES_TOOL_IMAGE } from './t3-fixture.mjs';
import { emailProbe, expectedSigningKid, observerProbes, probeEndpoints, probeReply,
  verificationFile, verificationHeader, verificationSecret, verificationSpec } from './t3-probe-fixture.mjs';

const alive = pid => { try { return readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1][0] !== 'Z'; } catch { return false; } };
const EXPECTED_PROBES = ['S-1', 'S-2', 'S-3', 'S-4', 'S-5', 'S-6', 'S-7', 'S-8', 'S-9a', 'S-9b', 'external-app', 'external-idp'];

test('R11 W8: finishOpen starts ui and auth-idp concurrently and keeps strict S-check order after both are ready', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r11-w8-')), savedPath = process.env.PATH;
  writeFileSync(join(dir, 'kubectl'), `#!/bin/sh
set -eu; a="$*"
case "$a" in
  *'scale deployment/api --replicas=1'*) : > '${dir}/ready-api';;
  *'rollout status deployment/ui '*)
    : > '${dir}/inflight-ui'; i=0; while [ ! -f '${dir}/inflight-idp' ] && [ "$i" -lt 25 ]; do sleep 0.02; i=$((i+1)); done
    [ -f '${dir}/inflight-idp' ] && : > '${dir}/overlapped'; sleep 0.1; rm -f '${dir}/inflight-ui'; : > '${dir}/ready-ui';;
  *'rollout status deployment/auth-idp '*)
    : > '${dir}/inflight-idp'; i=0; while [ ! -f '${dir}/inflight-ui' ] && [ "$i" -lt 25 ]; do sleep 0.02; i=$((i+1)); done
    [ -f '${dir}/inflight-ui' ] && : > '${dir}/overlapped'; sleep 0.1; rm -f '${dir}/inflight-idp'; : > '${dir}/ready-auth-idp';;
  *'delete middleware a4-verification'*) : > '${dir}/opened';;
  *'get middleware a4-verification -o json'*) echo '{"spec":${JSON.stringify(verificationSpec)}}';;
  *'get ingress '*) echo '{"metadata":{"annotations":{"traefik.ingress.kubernetes.io/router.middlewares":"sentropic-preprod-a4-verification@kubernetescrd"}}}';;
  *'get cronjob pgbackup -o json'*) echo '{"spec":{"suspend":true}}';;
  *'get deployment '*)
    name=\${a#*get deployment }; name=\${name%% *}; img=c; [ "$name" = ui ] && img=u
    [ -f '${dir}/ready-'"$name" ] && printf '{"metadata":{"generation":2},"status":{"readyReplicas":1,"observedGeneration":2},"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"%s","image":"%s"}]}}}}\\n' "$name" "$img" || printf '{"metadata":{"generation":1},"status":{"readyReplicas":0,"observedGeneration":1},"spec":{"replicas":0,"template":{"spec":{"containers":[{"name":"%s","image":"legacy"}]}}}}\\n' "$name";;
  *) echo '{}';;
esac
`, { mode: 0o755 });
  process.env.PATH = `${dir}:${savedPath}`;
  try {
    const config = { endpoints: probeEndpoints(), ...observerProbes(), emailProbe, expectedSigningKid, images: { candidate: 'c', ui: 'u' } };
    const built = buildProbes(config), idByUrl = new Map([...built.restrictedProbes, ...built.probes, ...built.externalProbes].map(p => [p.url, p.id]));
    const probeOrder = [], state = { namespace: 'sentropic-preprod', middlewareSpec: verificationSpec };
    const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir: dir });
    await finishOpen({ call, state, images: config.images, ...built, verification: verificationHeader,
      save: next => Object.assign(state, next),
      probe: async (url, opts) => {
        assert.ok(existsSync(join(dir, 'ready-ui')) && existsSync(join(dir, 'ready-auth-idp')));
        probeOrder.push(idByUrl.get(url));
        return probeReply(url, opts, existsSync(join(dir, 'opened')));
      } });
    assert.equal(existsSync(join(dir, 'overlapped')), true, 'ui and auth-idp rollouts must overlap in real time');
    assert.equal(state.substate, 'TWO_HOSTS_OPEN');
    assert.deepEqual(probeOrder, EXPECTED_PROBES);
  } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
});

test('R11 W8: failure in either frontal aborts sibling rollout subprocess and routes cleanly through rollback', async () => {
  for (const failing of ['ui', 'auth-idp']) {
    const dir = mkdtempSync(join(tmpdir(), 't3-r11-w8-fail-')), savedPath = process.env.PATH;
    writeFileSync(join(dir, 'kubectl'), `#!/bin/sh
set -eu; a="$*"
case "$a" in
  *'scale deployment/api --replicas=1'*) : > '${dir}/ready-api';;
  *'rollout status deployment/api '*) ;;
  *'rollout status deployment/${failing} '*) sleep 0.05; exit 1;;
  *'rollout status deployment/'*) printf '%s' "$$" > '${dir}/sibling.pid'; sleep 4;;
  *'get middleware a4-verification -o json'*) echo '{"spec":${JSON.stringify(verificationSpec)}}';;
  *'get ingress '*) echo '{"metadata":{"annotations":{"traefik.ingress.kubernetes.io/router.middlewares":"sentropic-preprod-a4-verification@kubernetescrd"}}}';;
  *'get deployment api -o json'*) [ -f '${dir}/ready-api' ] && echo '{"metadata":{"generation":2},"status":{"readyReplicas":1,"observedGeneration":2},"spec":{"replicas":1,"template":{"spec":{"containers":[{"name":"api","image":"c"}]}}}}' || echo '{"spec":{"replicas":0}}';;
  *'get deployment '*) echo '{"metadata":{"generation":1},"status":{"readyReplicas":0,"observedGeneration":1},"spec":{"replicas":0,"template":{"spec":{"containers":[{"name":"x","image":"legacy"}]}}}}';;
  *) echo '{}';;
esac
`, { mode: 0o755 });
    process.env.PATH = `${dir}:${savedPath}`;
    try {
      const config = { endpoints: probeEndpoints(), ...observerProbes(), emailProbe, expectedSigningKid, images: { candidate: 'c', ui: 'u' } };
      const state = { namespace: 'sentropic-preprod', middlewareSpec: verificationSpec };
      const call = runKubectl({ kubeconfig: '/private/kube', namespace: 'sentropic-preprod', stateDir: dir });
      let probesCalled = 0; const t0 = performance.now();
      await assert.rejects(finishOpen({ call, state, images: config.images, ...buildProbes(config), verification: verificationHeader,
        save: next => Object.assign(state, next), probe: async () => { probesCalled += 1; throw new Error('unexpected_probe'); } }), /kubectl_failed/);
      assert.ok(performance.now() - t0 < 1_500, 'sibling rollout must be aborted promptly');
      assert.equal(probesCalled, 0); assert.equal(state.substate, undefined);
      if (existsSync(join(dir, 'sibling.pid'))) assert.equal(alive(Number(readFileSync(join(dir, 'sibling.pid'), 'utf8'))), false);
      assert.deepEqual(readdirSync(dir).filter(n => n.startsWith('.t3-command-')), []);
    } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
  }
  const keyDir = mkdtempSync(join(tmpdir(), 't3-r11-drive-')), stateDir = mkdtempSync(join(tmpdir(), 't3-r11-state-'));
  const candidate = `ghcr.io/rhanka/sentropic-api@sha256:${'e'.repeat(64)}`, uiImg = 'ghcr.io/rhanka/sentropic-ui@sha256:ui';
  const legacyTpl = name => ({ spec: { containers: [{ name, image: `legacy-${name}` }] } });
  const witness = { url: 'https://idp.test/legacyWitness', cookie: 'synthetic-witness' }, salt = 'e'.repeat(64);
  const baseline = JSON.stringify({ ...applicabilityFixture(), witnessSalt: salt, witnessSha256: witnessBinding(witness, salt) });
  writeFileSync(join(keyDir, 'baseline.json'), baseline);
  for (const k of ['jwt', 'enc', 'idp']) writeFileSync(join(keyDir, k), `secret-${k}`);
  const qual = rehearsalFixture(keyDir, { candidateCommit: 'b'.repeat(40), candidateImage: candidate, operationId: 'test', namespace: 'sentropic-preprod' }, baseline);
  let classifyCount = 0, keysRemoved = false; const calls = [], active = { ui: false, 'auth-idp': false };
  const syncCall = (args, input) => {
    const cmd = args.join(' '); calls.push(cmd);
    if (cmd.startsWith('patch secret sentropic-api --type=json')) keysRemoved = true;
    if (cmd.startsWith('scale deployment/ui --replicas=')) active.ui = cmd.endsWith('=1');
    if (cmd.startsWith('scale deployment/auth-idp --replicas=')) active['auth-idp'] = cmd.endsWith('=1');
    if (cmd.startsWith('auth can-i')) return 'yes';
    if (args[0] === 'exec') {
      const s = String(input ?? '');
      if (args.some(a => String(a).includes('snapshot.json'))) return JSON.stringify(qual.snapshot);
      return s.includes('SHOW server_version') ? '17.11\n' : s.includes('cutover-applicability-v1') ? JSON.stringify(applicabilityFixture())
        : s.includes('AS acl_sha256') ? 'a'.repeat(64) : s.includes('journal_present') ? 't|0\n'
        : s.includes('identity_committed') ? ((classifyCount += 1) === 1 ? 't\n' : 'f\n') : s.includes('to_regclass') ? 'control.artifact_host_kv|t\n' : 'f\n';
    }
    if (cmd === 'rollout status deployment/ui --timeout=120s' && classifyCount === 1) throw new Error('kubectl_failed: rollout status deployment/ui');
    if (cmd === 'get secret a4-verification-auth -o json') return JSON.stringify(verificationSecret);
    if (cmd.startsWith('get secret ')) return keysRemoved ? '{"data":{}}' : '{"data":{"JWT_SECRET":"eA==","SECRET_ENCRYPTION_KEY":"eA=="}}';
    if (cmd === 'get middleware a4-verification -o json') return JSON.stringify({ spec: verificationSpec });
    if (cmd.startsWith('get ingress ')) return '{"metadata":{"annotations":{"traefik.ingress.kubernetes.io/router.middlewares":"sentropic-preprod-a4-verification@kubernetescrd"}}}';
    if (cmd === 'get pod postgres-0 -o json') return JSON.stringify({ status: { containerStatuses: [{ name: 'postgres', imageID: `docker.io/library/${PROD_POSTGRES_IMAGE}` }] } });
    if (cmd.startsWith('get cronjob ')) return JSON.stringify({ spec: { suspend: true, jobTemplate: { spec: { template: { spec: { initContainers: [{ name: cmd.includes('pgbackup') ? 'dump' : 'export-sql', image: PROD_POSTGRES_TOOL_IMAGE }] } } } } } });
    if (cmd.startsWith('get pods -l')) return JSON.stringify({ items: active[cmd.match(/component=([a-z-]+)/)?.[1]] ? [{ metadata: { name: 'p' } }] : [] });
    if (cmd.startsWith('get replicasets -l')) { const c = cmd.match(/component=([a-z-]+)/)?.[1]; return JSON.stringify({ items: [{ metadata: { annotations: { 'deployment.kubernetes.io/revision': '1' }, ownerReferences: [{ kind: 'Deployment', name: c }] }, spec: { template: legacyTpl(c) } }] }); }
    if (cmd.startsWith('get deployment ')) {
      const n = args[2];
      return n === 'api' && classifyCount === 0 && calls.includes('W7b-marker')
        ? JSON.stringify({ metadata: { generation: 2 }, status: { replicas: 1, readyReplicas: 1, observedGeneration: 2 }, spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: candidate }] } } } })
        : JSON.stringify({ metadata: { generation: 1 }, status: { replicas: 0, readyReplicas: 0, observedGeneration: 1 }, spec: { replicas: 0, template: legacyTpl(n) } });
    }
    return '{}';
  };
  syncCall.async = async (args, input) => { await new Promise(r => setTimeout(r, args[0] === 'rollout' ? 20 : 1)); return syncCall(args, input); };
  const code = await drive({ call: syncCall, stateDir, dryRun: false, probeReadOnly: false, tier: 'preprod', postgresPod: 'postgres-0', print: () => {},
    probe: async () => new Response('{}', { status: 200 }), verification: verificationHeader,
    delivered: (_ctx, _s, env) => { if (env.A4_ACTION === 'start-api') calls.push('W7b-marker'); return ''; },
    config: { kubeconfigFile: '/private/kube', namespace: 'sentropic-preprod', tier: 'preprod', candidateImage: candidate,
      templateDigests: Object.fromEntries(['api', 'auth-idp', 'ui'].map(n => [n, templateDigest(legacyTpl(n))])),
      images: { candidate, ui: uiImg }, endpoints: probeEndpoints(), ...observerProbes(), emailProbe, expectedSigningKid,
      request: { format: 'x', operationId: 'test', candidateCommit: 'b'.repeat(40), candidateImage: candidate },
      rotationKeyFiles: { apiJwtSecretFile: join(keyDir, 'jwt'), secretEncryptionKeyFile: join(keyDir, 'enc'), idpSessionJwtFile: join(keyDir, 'idp') },
      applicabilityBaselineFile: join(keyDir, 'baseline.json'), verificationCredentialFile: verificationFile(keyDir), witness, ...qual } });
  assert.equal(code, 3); assert.equal(loadState(stateDir).commitVerified, false);
  assert.ok(calls.includes('scale deployment/auth-idp --replicas=1'), 'auth-idp started concurrently with ui before ui failed');
  assert.deepEqual(active, { ui: true, 'auth-idp': true });
  rmSync(keyDir, { recursive: true, force: true }); rmSync(stateDir, { recursive: true, force: true });
});
