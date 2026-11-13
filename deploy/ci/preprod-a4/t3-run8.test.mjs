import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { buildProbes, loadState, monoMs, saveState, validateProbes } from './t3-lib.mjs';
import { drive, recover } from './t3-window-driver.mjs';
import { fence } from './t3-fence.mjs';
import { digest } from './guards.mjs';
import { approvedRequest } from './fixtures.mjs';
import { emailProbe, probeEndpoints, probeReply } from './t3-probe-fixture.mjs';
import { finishOpen } from './t3-finish-open.mjs';

const here = new URL('.', import.meta.url).pathname;
function acceptanceContext() {
  const config = { endpoints: probeEndpoints(), emailProbe, expectedSigningKid: 'qualified-kid', images: { candidate: 'c', ui: 'u' } };
  const writes = [], saved = [], seen = [];
  const ctx = { config, images: config.images, ...buildProbes(config),
    state: { namespace: 'sentropic-preprod', middlewareSpec: {} }, save: s => saved.push({ ...s }),
    probe: async (url, options) => { seen.push(url); return probeReply(url, options); },
    call: args => {
      if (args[0] !== 'get') { writes.push(args.join(' ')); return ''; }
      if (args[1] === 'deployment') {
        const name = args[2];
        return JSON.stringify({ spec: { replicas: 1, template: { spec: { containers: [{ name, image: name === 'ui' ? 'u' : 'c' }] } } },
          metadata: { generation: 1 }, status: { readyReplicas: 1, observedGeneration: 1 } });
      }
      if (args[1] === 'middleware') return '{"spec":{}}';
      if (args[1] === 'cronjob' && args[2] === 'sentropic-idp-identity-export') return '{"spec":{"suspend":true}}';
      if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
        'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } } });
      return '{}';
    } };
  return { ctx, writes, saved, seen };
}

test('RUN8 email probes satisfy the delivered JSON email input contract on both hosts', async () => {
  const config = { endpoints: probeEndpoints(), emailProbe: { email: 'cutover@example.test',
    headers: { 'x-csrf-token': 'synthetic' } } };
  const { probes } = buildProbes(config);
  for (const p of probes.filter(p => p.id.startsWith('S-9'))) {
    const req = new Request(p.url, p.options);
    assert.equal(req.method, 'POST');
    assert.equal(req.headers.get('content-type'), 'application/json');
    assert.equal(req.headers.get('x-csrf-token'), 'synthetic');
    assert.deepEqual(await req.json(), { email: config.emailProbe.email });
  }
});

for (const [id, body] of [
  ['S-3', { status: 'error' }], ['S-3', '<html>login</html>'],
  ['S-4', { issuer: 'https://wrong.test' }],
  ['S-4', { issuer: 'https://idp.test', authorization_endpoint: 'https://idp.test/wrong', token_endpoint: 'https://idp.test/api/v1/auth/oauth/token' }],
  ['S-5', { keys: [] }], ['S-5', { keys: [{ kid: 'wrong', kty: 'OKP', crv: 'Ed25519', x: 'public' }] }],
  ['S-5', { keys: [{ kid: 'qualified-kid', kty: 'RSA', x: 'public' }] }],
  ['S-7', { error: 'Authentication failed' }], ['S-8', {}],
  ['S-9a', { success: false }], ['S-9b', { success: true, delivery: 'email', expiresAt: 'invalid' }],
]) {
  test(`RUN8 rejects functional proof ${id} ${JSON.stringify(body)} before ACCEPTED`, async () => {
    const { ctx, saved, writes } = acceptanceContext();
    const bad = ctx.probes.find(p => p.id === id).url;
    const normal = ctx.probe;
    ctx.probe = async (url, options) => url === bad
      ? new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status: ctx.probes.find(p => p.id === id).expect,
        headers: { 'content-type': typeof body === 'string' ? 'text/html' : 'application/json' } }) : normal(url, options);
    await assert.rejects(finishOpen(ctx), /probe_failed/);
    assert.equal(saved.length, 0);
    assert.equal(writes.length, 0, 'no backup resume or traffic opening');
  });
}

test('RUN8 missing dedicated email input refuses before fence', () => {
  assert.throws(() => validateProbes(buildProbes({ endpoints: probeEndpoints() }).probes), /email_probe_input/);
});

test('RUN8 finish-open CLI preview preserves active bytes and real resumption still probes and opens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-finish-preview-'));
  const { ctx, seen, writes } = acceptanceContext();
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify(ctx.config));
  saveState(dir, { ...ctx.state, step: 'W8', substate: 'POSTCOMMIT_RESTRICTED' });
  const before = readFileSync(join(dir, 't3-window-state.json'), 'utf8');
  const out = spawnSync(process.execPath, [`${here}t3-finish-open.mjs`, '--config', configPath,
    '--state-dir', dir, '--dry-run'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(readFileSync(join(dir, 't3-window-state.json'), 'utf8'), before);
  ctx.state = loadState(dir);
  await finishOpen(ctx);
  assert.equal(seen.length, 8, 'preview cannot cause a real resume to skip acceptance');
  assert.ok(writes.some(w => w.startsWith('annotate ingress')));
  assert.equal(ctx.state.substate, 'TWO_HOSTS_OPEN');
});

for (const refusal of ['rbac', 'annex']) {
  test(`RUN8 ${refusal} refusal before fence causes zero recovery mutations`, async () => {
    const { ctx, writes } = acceptanceContext();
    const dir = mkdtempSync(join(tmpdir(), 't3-refusal-'));
    const original = ctx.call;
    ctx.stateDir = dir;
    ctx.print = () => {};
    ctx.tier = 'preprod';
    ctx.config.tier = 'preprod';
    ctx.config.kubeconfigFile = join(dir, 'kube');
    ctx.config.authorizationFile = join(dir, 'authorization.json');
    ctx.config.executionFile = join(dir, 'annex.json');
    writeFileSync(ctx.config.kubeconfigFile, 'synthetic', { mode: 0o600 });
    writeFileSync(ctx.config.authorizationFile, JSON.stringify({ ...approvedRequest, format: 'preprod-a4-authorization/1' }), { mode: 0o600 });
    writeFileSync(ctx.config.executionFile, '{}', { mode: 0o600 });
    ctx.config.executionSha256 = digest('{}');
    ctx.call = args => args[0] === 'auth' ? refusal === 'rbac' ? 'no' : 'yes' : original(args);
    // Preserve the observation even if a broken recovery itself fails later.
    try { await drive(ctx); } catch {}
    assert.deepEqual(writes, []);
    assert.equal(loadState(dir).watchdogDone, true, 'pre-fence refusal disarms recovery');
  });
}

test('RUN8 partially applied delivered fence persists intent and still recovers after response loss', async () => {
  const { ctx, writes } = acceptanceContext();
  ctx.stateDir = mkdtempSync(join(tmpdir(), 't3-partial-fence-'));
  ctx.print = () => {};
  ctx.config.revisions = {};
  const state = { ...ctx.state, step: 'W1', fenceStarted: false };
  saveState(ctx.stateDir, state);
  const env = { A4_TIER: 'preprod', A4_ACTION: 'fence', A4_DRY_RUN: '0', T3_STATE_DIR: ctx.stateDir };
  const authorization = { ...approvedRequest, format: 'preprod-a4-authorization/1' };
  const annex = JSON.stringify({ ...authorization, format: 'preprod-a4-execution/1',
    actions: { fence: [['scale', 'deployment/api', '--replicas=0'], ['scale', 'deployment/ui', '--replicas=0']] } });
  for (const [key, contents] of [['A4_KUBECONFIG_FILE', 'synthetic'],
    ['A4_AUTHORIZATION_FILE', JSON.stringify(authorization)], ['A4_EXECUTION_FILE', annex]]) {
    env[key] = join(ctx.stateDir, key);
    writeFileSync(env[key], contents, { mode: 0o600 });
  }
  env.A4_EXECUTION_SHA256 = digest(annex);
  assert.throws(() => fence(env, (_kube, args) => {
    assert.equal(loadState(ctx.stateDir).fenceStarted, true, 'marker precedes first write');
    writes.push(args.join(' '));
    throw new Error('response_lost_after_write');
  }), /response_lost/);
  assert.equal(await recover(ctx, state, 'partial-fence'), 3);
  assert.ok(writes.includes('scale deployment/ui --replicas=1'), 'rollback completes even with stale parent state');
  assert.equal(loadState(ctx.stateDir).step, 'DONE');
});

test('RUN8 JSON response consumption remains inside the shared HTTP deadline', async () => {
  const { ctx, saved, writes } = acceptanceContext();
  let requested = false;
  const server = createServer((_req, res) => {
    requested = true;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"status":'); // headers succeed, functional proof never completes
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const normal = ctx.probe;
  const url = `http://127.0.0.1:${server.address().port}/health`;
  ctx.probes.find(p => p.id === 'S-3').url = url;
  ctx.probe = (target, options) => target === url ? fetch(target, options) : normal(target, options);
  ctx.deadlineMs = monoMs() + 300;
  const started = performance.now();
  try {
    await assert.rejects(finishOpen(ctx), /probe_failed: S-3/);
    assert.ok(requested, 'actual HTTP headers were received');
    assert.ok(performance.now() - started < 1500, 'body cannot outlive the window');
    assert.equal(saved.length, 0);
    assert.equal(writes.length, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
