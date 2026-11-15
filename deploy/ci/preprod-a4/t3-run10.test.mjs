import assert from 'node:assert/strict';
import { test } from 'node:test';
import { finishOpen } from './t3-finish-open.mjs';
import { preCommitRollback } from './t3-rollback.mjs';
import { buildProbes } from './t3-lib.mjs';
import { emailProbe, expectedSigningKid, observerProbes, probeEndpoints, probeReply,
  verificationHeader, verificationSpec } from './t3-probe-fixture.mjs';

function finishContext(clockRef) {
  const config = { endpoints: probeEndpoints(), ...observerProbes(), emailProbe,
    expectedSigningKid, images: { candidate: 'c', ui: 'u' }, middlewareSpec: verificationSpec };
  const writes = [], state = { namespace: 'sentropic-preprod', middlewareSpec: verificationSpec };
  return { writes, state, ctx: {
    images: config.images, ...buildProbes(config), verification: verificationHeader, state,
    now: () => clockRef.ms, save: next => Object.assign(state, next),
    call: args => {
      if (args[0] !== 'get') { writes.push(args.join(' ')); return ''; }
      if (args[1] === 'deployment') {
        const name = args[2];
        return JSON.stringify({ metadata: { generation: 1 }, status: { readyReplicas: 1, observedGeneration: 1 },
          spec: { replicas: 1, template: { spec: { containers: [{ name, image: name === 'ui' ? 'u' : 'c' }] } } } });
      }
      if (args[1] === 'middleware') return JSON.stringify({ spec: verificationSpec });
      if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
        'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } } });
      return '{}';
    } } };
}
const rollbackCall = () => args => args[0] === 'get' && args[1] === 'pods' ? '{"items":[]}'
  : args[0] === 'get' && args[1] === 'cronjob' ? '{"spec":{"suspend":true}}' : '{}';
const staleBasic = () => new Response('401\n', { status: 401, headers: { 'www-authenticate': 'Basic realm="traefik"' } });
const stale404 = () => new Response('404 page not found\n', { status: 404, headers: { 'content-type': 'text/plain' } });

test('RUN10 D1 finishOpen retries S-2 and E-1/E-2 on stale Traefik routes and transport errors within 3 s', async () => {
  const clockRef = { ms: 10_000 }, { ctx, writes, state } = finishContext(clockRef), counts = new Map();
  ctx.probe = async (url, options) => {
    const n = (counts.get(url) ?? 0) + 1; counts.set(url, n);
    if (url.endsWith('/restricted1')) {
      if (n === 1) { clockRef.ms += 250; throw new TypeError('fetch failed'); }
      if (n === 2) { clockRef.ms += 400; return stale404(); }
    }
    if (url.endsWith('/external-app')) {
      if (n === 1) { clockRef.ms += 500; return staleBasic(); }
      if (n === 2) { clockRef.ms += 600; return stale404(); }
    }
    if (url.endsWith('/external-idp') && n === 1) {
      clockRef.ms += 300;
      return new Response('Service Unavailable\n', { status: 503, headers: { 'content-type': 'text/plain' } });
    }
    return probeReply(url, options, writes.some(w => w.startsWith('delete middleware a4-verification')));
  };
  await finishOpen(ctx);
  assert.equal(state.substate, 'TWO_HOSTS_OPEN');
  assert.deepEqual([counts.get(ctx.restrictedProbes[1].url), counts.get(ctx.externalProbes[0].url),
    counts.get(ctx.externalProbes[1].url)], [3, 3, 2]);
  for (const p of ctx.probes.filter(p => p.id.startsWith('S-9'))) assert.equal(counts.get(p.url), 1);
});

test('RUN10 D1 preCommitRollback verifyService retries health, JWKS and witness on stale Traefik routes within 3 s', async () => {
  let clock = 20_000; const counts = new Map();
  await preCommitRollback({
    call: rollbackCall(), now: () => clock,
    healthUrl: 'https://app.restore-a4.test/api/v1/health',
    jwksUrl: 'https://auth.restore-a4.test/.well-known/jwks.json',
    witness: { url: 'https://app.restore-a4.test/api/v1/me', cookie: 'synthetic-witness' },
    probe: async (url, options) => {
      assert.equal(options.redirect, 'error');
      const n = (counts.get(url) ?? 0) + 1; counts.set(url, n);
      if (url.endsWith('/health') && n === 1) { clock += 300; throw new TypeError('fetch failed'); }
      if (url.endsWith('/health') && n === 2) { clock += 400; return staleBasic(); }
      if (url.endsWith('/jwks.json') && n === 1) { clock += 500; return stale404(); }
      if (url.endsWith('/me')) {
        assert.equal(options.headers.cookie, 'synthetic-witness');
        if (n === 1) { clock += 500; return staleBasic(); }
      }
      return new Response('{}', { status: 200 });
    },
  });
  assert.deepEqual([counts.get('https://app.restore-a4.test/api/v1/health'),
    counts.get('https://auth.restore-a4.test/.well-known/jwks.json'),
    counts.get('https://app.restore-a4.test/api/v1/me')], [3, 2, 2]);
  assert.ok(clock - 20_000 <= 3_000);
});

test('RUN10 D1 bounded retry never masks real refusals and stops strictly at 3 s or window deadline', async () => {
  for (const [reply, errRe] of [
    [() => new Response('open', { status: 200 }), /probe_failed: S-2$/],
    [() => new Response('forbidden', { status: 403 }), /probe_failed: S-2$/],
    [() => Response.json({ error: { code: 'unauthorized' } }, { status: 401 }), /probe_failed: S-2 boundary_challenge/],
    [() => Response.json({ error: 'not_found' }, { status: 404 }), /probe_failed: S-2$/],
  ]) {
    const { ctx, writes } = finishContext({ ms: 1_000 }); let attempts = 0;
    ctx.probe = async (url, opts) => url.endsWith('/restricted1') ? (attempts += 1, reply()) : probeReply(url, opts, false);
    await assert.rejects(finishOpen(ctx), errRe);
    assert.deepEqual([attempts, writes.length], [1, 0]);
  }
  for (const badWitness of [
    () => Response.json({ error: { code: 'unauthorized' } }, { status: 401 }),
    () => new Response('forbidden', { status: 403 }),
    () => new Response('error', { status: 500 }),
    () => { throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') }); },
  ]) {
    let attempts = 0;
    await assert.rejects(preCommitRollback({
      call: rollbackCall(), healthUrl: 'https://app.restore-a4.test/api/v1/health',
      jwksUrl: 'https://auth.restore-a4.test/.well-known/jwks.json',
      witness: { url: 'https://app.restore-a4.test/api/v1/me', cookie: 'expired' },
      probe: async url => url.endsWith('/me') ? (attempts += 1, badWitness()) : new Response('{}', { status: 200 }),
    }), /rollback_witness_failed/);
    assert.equal(attempts, 1);
  }
  const clockRef = { ms: 50_000 }, { ctx } = finishContext(clockRef); let extAttempts = 0;
  ctx.state.substate = 'TWO_HOSTS_OPEN';
  ctx.probe = async url => url.endsWith('/external-app')
    ? (extAttempts += 1, clockRef.ms += 1_000, stale404()) : new Response('ok', { status: 200 });
  await assert.rejects(finishOpen(ctx), /probe_failed: external-app$/);
  assert.equal(extAttempts, 3);
  assert.ok(clockRef.ms - 50_000 <= 3_000);
  let clock = 80_000, witnessAttempts = 0;
  await assert.rejects(preCommitRollback({
    call: rollbackCall(), now: () => clock, healthUrl: 'https://app.restore-a4.test/api/v1/health',
    jwksUrl: 'https://auth.restore-a4.test/.well-known/jwks.json',
    witness: { url: 'https://app.restore-a4.test/api/v1/me', cookie: 'synthetic' },
    probe: async url => url.endsWith('/health') && clock < 82_400 ? (clock += 1_200, staleBasic())
      : url.endsWith('/me') ? (witnessAttempts += 1, clock += 700, staleBasic()) : new Response('{}', { status: 200 }),
  }), /rollback_witness_failed/);
  assert.equal(witnessAttempts, 1);
});
