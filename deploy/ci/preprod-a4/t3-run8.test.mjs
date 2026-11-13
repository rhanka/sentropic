import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProbes, loadState, saveState, validateProbes } from './t3-lib.mjs';
import { emailProbe, probeEndpoints, probeReply } from './t3-probe-fixture.mjs';
import { finishOpen } from './t3-finish-open.mjs';

const here = new URL('.', import.meta.url).pathname;
function acceptanceContext() {
  const config = { endpoints: probeEndpoints(), emailProbe, images: { candidate: 'c', ui: 'u' } };
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
