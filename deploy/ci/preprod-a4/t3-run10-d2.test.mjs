import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadState, saveState } from './t3-lib.mjs';
import { preflight } from './t3-preflight-static.mjs';
import { inputs } from './t3-preflight.test.mjs';
import { preCommitRollback, templateDigest } from './t3-rollback.mjs';
import { checkTemplateDigests } from './t3-window-driver.mjs';
import { emailProbe, expectedSigningKid, observerProbes, probeEndpoints, verificationFile } from './t3-probe-fixture.mjs';

const here = new URL('.', import.meta.url).pathname;
const tpl = (name, image, extra = {}) => ({
  metadata: { labels: { 'app.kubernetes.io/name': 'sentropic', 'app.kubernetes.io/component': name } },
  spec: { containers: [{ name, image }], ...extra },
});

function k8sCluster({ breakRestore = false } = {}) {
  const leg = { api: tpl('api', 'leg-api'), 'auth-idp': tpl('auth-idp', 'leg-idp'), ui: tpl('ui', 'leg-ui') };
  const cand = {
    api: tpl('api', 'cand-api', { volumes: [{ name: 'c', persistentVolumeClaim: { claimName: 'sentropic-a4-custody' } }] }),
    'auth-idp': tpl('auth-idp', 'cand-idp', { volumes: [{ name: 's', persistentVolumeClaim: { claimName: 'auth-idp-session-authority' } }] }),
    ui: tpl('ui', 'leg-ui'),
  };
  const deploys = {
    api: { rev: 2, gen: 2, obsGen: 2, replicas: 0, template: structuredClone(cand.api) },
    'auth-idp': { rev: 2, gen: 2, obsGen: 2, replicas: 0, template: structuredClone(cand['auth-idp']) },
    ui: { rev: 1, gen: 1, obsGen: 1, replicas: 0, template: structuredClone(leg.ui) },
  };
  const history = {
    api: [{ rev: 1, template: structuredClone(leg.api) }, { rev: 2, template: structuredClone(cand.api) }],
    'auth-idp': [{ rev: 1, template: structuredClone(leg['auth-idp']) }, { rev: 2, template: structuredClone(cand['auth-idp']) }],
    ui: [{ rev: 1, template: structuredClone(leg.ui) }],
  };
  const nextRev = { api: 3, 'auth-idp': 3, ui: 2 }, undos = [];
  const call = args => {
    const cmd = args.join(' ');
    if (cmd.startsWith('scale deployment/')) {
      const [, name] = cmd.match(/^scale deployment\/(\S+)/);
      deploys[name].replicas = Number(cmd.split('--replicas=')[1]);
      deploys[name].gen += 1;
      return '';
    }
    if (cmd.startsWith('get deployment ')) {
      const d = deploys[args[2]];
      return JSON.stringify({ metadata: { annotations: { 'deployment.kubernetes.io/revision': String(d.rev) }, generation: d.gen },
        status: { replicas: d.replicas, readyReplicas: d.replicas, observedGeneration: d.obsGen },
        spec: { replicas: d.replicas, template: { metadata: { ...d.template.metadata, creationTimestamp: null }, spec: d.template.spec } } });
    }
    if (cmd.startsWith('get replicasets -l ')) {
      const name = cmd.match(/component=([a-z-]+)/)[1];
      return JSON.stringify({ items: history[name].map(h => ({
        metadata: { annotations: { 'deployment.kubernetes.io/revision': String(h.rev) }, ownerReferences: [{ kind: 'Deployment', name }] },
        spec: { template: { metadata: { ...h.template.metadata, creationTimestamp: null,
          labels: { ...h.template.metadata.labels, 'pod-template-hash': `hash-${h.rev}` } }, spec: h.template.spec } },
      })) });
    }
    if (cmd.startsWith('rollout undo deployment/')) {
      const name = args[2].split('/')[1], wantRev = Number((args[3] ?? '').split('=')[1]);
      undos.push(`${name}:${wantRev}`);
      const target = history[name].find(h => h.rev === wantRev);
      if (!target) throw new Error(`kubectl_failed: unable to find specified revision ${wantRev} in history`);
      const promoted = nextRev[name]++;
      target.rev = promoted; deploys[name].rev = promoted; deploys[name].gen += 1;
      if (!breakRestore) deploys[name].template = structuredClone(target.template);
      return '';
    }
    if (cmd.startsWith('get pods')) return '{"items":[]}';
    if (cmd.startsWith('get cronjob sentropic-idp-identity-export')) return '{"spec":{"suspend":true}}';
    return '{}';
  };
  const templateDigests = Object.fromEntries(Object.entries(leg).map(([k, v]) => [k, templateDigest(v)]));
  return { leg, cand, deploys, history, undos, call, templateDigests };
}

test('RUN10 D2 preCommitRollback is idempotent across repeated runs after rollout undo renumbers revision 1 -> 3', async () => {
  const c = k8sCluster();
  await assert.rejects(preCommitRollback({
    call: c.call, templateDigests: c.templateDigests,
    healthUrl: 'https://app.restore-a4.test/api/v1/health', jwksUrl: 'https://auth.restore-a4.test/.well-known/jwks.json',
    probe: async () => new Response('fault', { status: 500 }),
  }), /rollback_verify_failed/);
  assert.deepEqual(c.undos, ['api:1', 'auth-idp:1']);
  assert.deepEqual(c.history.api.map(h => h.rev), [3, 2], 'revision 1 destroyed by first rollout undo');
  await preCommitRollback({
    call: c.call, templateDigests: c.templateDigests,
    healthUrl: 'https://app.restore-a4.test/api/v1/health', jwksUrl: 'https://auth.restore-a4.test/.well-known/jwks.json',
    probe: async () => new Response('{}', { status: 200 }),
  });
  assert.deepEqual(c.undos, ['api:1', 'auth-idp:1'], 'second preCommitRollback issues zero rollout undo calls');
});

test('RUN10 D2 Kill-1a t3-emergency.sh succeeds after watchdog already promoted revision 1 -> 3, and resolves renumbered ReplicaSets by digest', async () => {
  const c = k8sCluster();
  c.history.api = [{ rev: 3, template: structuredClone(c.leg.api) }, { rev: 4, template: structuredClone(c.cand.api) }];
  c.deploys.api.rev = 4;
  await preCommitRollback({ call: c.call, templateDigests: c.templateDigests });
  assert.deepEqual(c.undos, ['api:3', 'auth-idp:1']);

  const dir = mkdtempSync(join(tmpdir(), 't3-k1a-'));
  const http = spawn(process.execPath, [`${here}t3-probe-fixture.mjs`, join(dir, 'port'), join(dir, 'open')], { stdio: 'ignore' });
  while (!existsSync(join(dir, 'port'))) await new Promise(r => setTimeout(r, 20));
  const origin = `http://127.0.0.1:${readFileSync(join(dir, 'port'), 'utf8')}`, cfg = join(dir, 'config.json');
  const depJson = (rev, gen, template) => JSON.stringify({ metadata: { annotations: { 'deployment.kubernetes.io/revision': rev }, generation: gen },
    status: { replicas: 0, observedGeneration: gen - 1 }, spec: { replicas: 0, template } });
  writeFileSync(cfg, JSON.stringify({ kubeconfigFile: '/private/kube', namespace: 'sentropic-restore-a4', tier: 'restore',
    endpoints: probeEndpoints(origin), ...observerProbes(origin), emailProbe, expectedSigningKid, verificationCredentialFile: verificationFile(dir),
    witness: { url: `${origin}/legacyWitness`, cookie: 'synthetic-witness' }, templateDigests: c.templateDigests }), { mode: 0o600 });
  saveState(dir, { step: 'W3', commitVerified: false, locks: 0, templateDigests: c.templateDigests });
  writeFileSync(join(dir, 'kubectl'), ['#!/bin/sh', 'set -eu', 'case "$*" in',
    "*'rollout undo'*) echo 'error: unable to find specified revision 1 in history' >&2; exit 1;;",
    "*'delete middleware a4-verification'*) : > '" + dir + "/open';;",
    "*'get pods'*) echo '{\"items\":[]}';;",
    "*'get cronjob sentropic-idp-identity-export'*) echo '{\"spec\":{\"suspend\":true}}';;",
    "*'get deployment api '*) printf '%s\\n' '" + depJson('3', 5, c.leg.api) + "';;",
    "*'get deployment auth-idp '*) printf '%s\\n' '" + depJson('3', 5, c.leg['auth-idp']) + "';;",
    "*'get deployment ui '*) printf '%s\\n' '" + depJson('1', 2, c.leg.ui) + "';;",
    "*'exec '*) echo 'f|0';;", '*) echo \'{}\';;', 'esac', ''].join('\n'), { mode: 0o700 });
  try {
    const out = spawnSync('sh', [`${here}t3-emergency.sh`, '--state-dir', dir, '--config', cfg],
      { env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 8000 });
    assert.equal(out.status, 0, `${out.stderr}\n${out.stdout}`);
    assert.match(out.stdout, /rollback_ok/);
    assert.equal(loadState(dir).step, 'DONE');
  } finally { http.kill('SIGKILL'); }
});

test('RUN10 D2 fail-closed on missing/mismatched/stale template digest in rollback, preflight, and W0', async () => {
  const c = k8sCluster();
  c.history.api = [{ rev: 2, template: structuredClone(c.cand.api) }];
  await assert.rejects(preCommitRollback({ call: c.call, templateDigests: c.templateDigests }), /rollback_template_not_found: api/);
  const broken = k8sCluster({ breakRestore: true });
  await assert.rejects(preCommitRollback({ call: broken.call, templateDigests: broken.templateDigests }), /rollback_template_mismatch: api/);
  const dir = mkdtempSync(join(tmpdir(), 't3-w0-tpl-')), state = { step: 'W0' };
  assert.throws(() => checkTemplateDigests({ call: c.call, config: { templateDigests: c.templateDigests }, stateDir: dir }, state),
    /template_digest_stale_before_fence: api/);
  c.deploys.api.template = structuredClone(c.leg.api); c.deploys['auth-idp'].template = structuredClone(c.leg['auth-idp']);
  checkTemplateDigests({ call: c.call, config: { templateDigests: c.templateDigests }, stateDir: dir }, state);
  assert.deepEqual(loadState(dir).templateDigests, c.templateDigests);
  const f = inputs();
  f.config.templateDigests = { ...c.templateDigests, api: 'bad' };
  assert.throws(() => preflight(f.config, f.read), /template_digest_missing/);
});
