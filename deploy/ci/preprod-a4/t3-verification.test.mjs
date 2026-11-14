import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateMiddleware } from './execution.mjs';
import { canonical, digest } from './guards.mjs'; import { finishOpen } from './t3-finish-open.mjs';
import { buildProbes, validateObservers } from './t3-lib.mjs';
import { maintenance } from './t3-maintenance.mjs'; import { checkVerification } from './t3-window-driver.mjs';
import { assertVerificationSecret, provisionVerification, verificationCredential, verificationSpecValid } from './verification-boundary.mjs';
import { emailProbe, expectedSigningKid, observerProbes, probeEndpoints, probeReply, verificationFile, verificationHeader,
  verificationLine, verificationSecret, verificationSpec } from './t3-probe-fixture.mjs';

const grant = spec => ({ middlewareSpec: spec, middlewareSpecSha256: digest(canonical(spec)) });

// The load balancer hides the client address from Traefik: a /32 allow list can never match the operator.
test('should refuse a source-range boundary and accept only basicAuth by the named Secret', () => {
  assert.deepEqual(validateMiddleware(grant(verificationSpec)), verificationSpec);
  for (const spec of [{ ipAllowList: { sourceRange: ['192.0.2.10/32'] } }, { basicAuth: { secret: 'a4-verification-auth' } },
    { basicAuth: { secret: 'another-secret', removeHeader: true } }, { basicAuth: { secret: 'a4-verification-auth', removeHeader: false } },
    { basicAuth: { users: ['operator:{SHA}inline'], removeHeader: true } },
    { ...verificationSpec, ipAllowList: { sourceRange: ['192.0.2.10/32'] } }, { basicAuth: 'a4-verification-auth' }, {}]) {
    assert.equal(verificationSpecValid(spec), false, JSON.stringify(spec));
    assert.throws(() => validateMiddleware(grant(spec)), /traffic_boundary_invalid/);
  }
});

test('should derive the header and the SHA-1 verifier from one private line and refuse weak or missing input', () => {
  const { header, users } = verificationCredential('/credential', () => `${verificationLine}\n`);
  assert.equal(header, verificationHeader);
  assert.equal(Buffer.from(verificationSecret.data.users, 'base64').toString(), users);
  assert.doesNotMatch(users, /synthetic-verification-credential/);
  assert.throws(() => verificationCredential(undefined), /verification_credential_missing/);
  for (const line of ['', 'operator:short', 'no-separator-0123456789012345678901234567890', `bad user:${'p'.repeat(40)}`,
    `operator:${'p'.repeat(1025)}`, `operator:with space ${'p'.repeat(40)}`]) {
    assert.throws(() => verificationCredential('/credential', () => line), /verification_credential_invalid/, line);
  }
});

function acceptance(overrides = {}) {
  const config = { endpoints: probeEndpoints(), emailProbe, expectedSigningKid, ...observerProbes() };
  const writes = [], requests = [];
  const ctx = { images: { candidate: 'c', ui: 'u' }, ...buildProbes(config), verification: verificationHeader, save: () => {},
    state: { namespace: 'sentropic-preprod', middlewareSpec: verificationSpec },
    probe: async (url, options) => { requests.push({ url, authorization: new Headers(options.headers).get('authorization') }); return probeReply(url, options); },
    call: args => {
      if (args[0] !== 'get') { writes.push(args.join(' ')); return ''; }
      if (args[1] === 'deployment') return JSON.stringify({ metadata: { generation: 1 }, status: { readyReplicas: 1, observedGeneration: 1 },
        spec: { replicas: 1, template: { spec: { containers: [{ name: args[2], image: args[2] === 'ui' ? 'u' : 'c' }] } } } });
      if (args[1] === 'middleware') return JSON.stringify({ spec: verificationSpec });
      if (args[1] === 'ingress') return JSON.stringify({ metadata: { annotations: {
        'traefik.ingress.kubernetes.io/router.middlewares': 'sentropic-preprod-a4-verification@kubernetescrd' } } });
      return '{}';
    }, ...overrides };
  return { ctx, writes, requests };
}

test('should send the credential on every functional probe and none on the excluded observers', async () => {
  const { ctx, requests } = acceptance();
  await finishOpen(ctx);
  assert.equal(ctx.state.substate, 'TWO_HOSTS_OPEN');
  const observers = requests.filter(request => /restricted[01]$/.test(request.url));
  assert.ok(observers.length === 2 && observers.every(request => request.authorization === null));
  const functional = requests.filter(request => request.url.includes('probe='));
  assert.ok(functional.length === 8 && functional.every(request => request.authorization === verificationHeader));
});

test('should refuse acceptance without the credential before any Kubernetes write or HTTP request', async () => {
  const { ctx, writes, requests } = acceptance({ verification: undefined });
  await assert.rejects(finishOpen(ctx), /verification_credential_missing/);
  assert.deepEqual([writes, requests], [[], []]);
  const wrong = acceptance({ verification: `Basic ${Buffer.from('t3-verify:another-credential-0123456789012345').toString('base64')}` });
  await assert.rejects(finishOpen(wrong.ctx), /probe_failed: S-3/);
  assert.equal(wrong.ctx.state.substate, undefined);
});

// S-1/S-2: the refusal must be Traefik's own (401 with a Basic challenge). An open route, the former
// 403 and an application 401 all mean the boundary is not the one that answered.
for (const [name, reply, error] of [
  ['an open route', () => new Response('application', { status: 200 }), /probe_failed: S-1$/],
  ['a source-range refusal', () => new Response('Forbidden', { status: 403 }), /probe_failed: S-1$/],
  ['an application 401', () => Response.json({ error: { code: 'unauthorized' } }, { status: 401 }), /probe_failed: S-1 boundary_challenge/],
  ['a bearer challenge', () => new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="app"' } }), /boundary_challenge/]]) {
  test(`should keep traffic restricted when the observer meets ${name}`, async () => {
    const { ctx, writes } = acceptance();
    const normal = ctx.probe;
    ctx.probe = (url, options) => url.endsWith('restricted0') ? reply() : normal(url, options);
    await assert.rejects(finishOpen(ctx), error);
    assert.equal(ctx.state.substate, undefined);
    assert.equal(writes.length, 0, 'no backup resume or traffic opening');
  });
}

test('should require both observers to expect the proxy refusal', () => {
  assert.doesNotThrow(() => validateObservers({ ...observerProbes(), externalProbes: observerProbes().externalProbes }));
  for (const expect of [403, 200]) {
    const config = observerProbes(); config.restrictedProbes[1].expect = expect;
    assert.throws(() => validateObservers(config), /restricted_observer_missing/);
  }
});

test('should compare the cluster Secret with the local credential and refuse any other content', () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-verification-'));
  const config = { verificationCredentialFile: verificationFile(dir) };
  const ctx = secret => ({ config, dryRun: false, print() {}, call: args => {
    assert.deepEqual(args, ['get', 'secret', 'a4-verification-auth', '-o', 'json']);
    if (secret === undefined) throw new Error('kubectl_failed: NotFound');
    return JSON.stringify(secret);
  } });
  assert.equal(checkVerification(ctx(verificationSecret)), verificationHeader);
  assert.throws(() => checkVerification(ctx(undefined)), /verification_secret_missing/);
  const other = Buffer.from('t3-verify:{SHA}AAAAAAAAAAAAAAAAAAAAAAAAAAA=\n').toString('base64');
  for (const secret of [{ type: 'Opaque', data: { users: other } }, { type: 'Opaque', data: { ...verificationSecret.data, extra: 'eA==' } },
    { type: 'kubernetes.io/basic-auth', data: verificationSecret.data }, { type: 'Opaque', data: {} }, {}]) {
    assert.throws(() => checkVerification(ctx(secret)), /verification_secret_mismatch/, JSON.stringify(secret));
  }
  assert.throws(() => checkVerification({ config: {}, dryRun: false, call: () => assert.fail('Kubernetes called') }), /verification_credential_missing/);
  assert.equal(checkVerification({ config: {}, dryRun: true, call: () => assert.fail('Kubernetes called') }), null);
});

test('should provision the Secret from a private credential, verifier only, and never under an active boundary', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-provision-')), path = join(dir, 'credential');
  const calls = [];
  const call = (args, input) => { calls.push({ args, input }); return ''; };
  assert.deepEqual(provisionVerification(path, 'sentropic-restore-a4', call), { verificationSecret: 'a4-verification-auth' });
  assert.equal(statSync(path).mode & 0o777, 0o600);
  const line = readFileSync(path, 'utf8').trim();
  assert.match(line, /^t3-verify:[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(calls.map(entry => entry.args.slice(0, 3).join(' ')), ['get middleware a4-verification', 'delete secret a4-verification-auth', 'create -f -']);
  const secret = JSON.parse(calls[2].input);
  assert.deepEqual([secret.kind, secret.type, secret.metadata, Object.keys(secret.data)],
    ['Secret', 'Opaque', { name: 'a4-verification-auth', namespace: 'sentropic-restore-a4' }, ['users']]);
  assertVerificationSecret(secret, verificationCredential(path).users);
  // No call carries the credential itself, on argv or stdin.
  const password = line.split(':')[1];
  assert.ok(!JSON.stringify(calls).includes(password) && !Buffer.from(secret.data.users, 'base64').toString().includes(password));
  provisionVerification(path, 'sentropic-restore-a4', call);
  assert.equal(readFileSync(path, 'utf8').trim(), line, 'an existing credential is kept');
  assert.throws(() => provisionVerification(path, 'sentropic-restore-a4', args => args[0] === 'get' ? 'middleware.traefik.io/a4-verification\n' : assert.fail('written')),
    /verification_boundary_active/);
  const configPath = join(dir, 'config.json');
  writeFileSync(configPath, JSON.stringify({ namespace: 'sentropic-restore-a4', verificationCredentialFile: path }), { mode: 0o600 });
  await assert.rejects(maintenance(['verification-secret', configPath, dir]), /maintenance_action_not_explicit/);
});
