import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { kubectl } from './guards.mjs';
import { summarize } from './t3-chrono.mjs';
import { applicabilityFixture } from './t3-applicability.test.mjs';
import { PROD_POSTGRES_IMAGE, PROD_POSTGRES_TOOL_IMAGE } from './t3-fixture.mjs';
import * as proxyMod from './t3-kubectl-proxy.mjs';
import { loadState, monoMs, runKubectl, saveState } from './t3-lib.mjs';
import { inputs } from './t3-preflight.test.mjs';
import { verificationSecret } from './t3-probe-fixture.mjs';
import { templateDigest } from './t3-rollback.mjs';
import { poll } from './t3-watchdog.mjs';
import { drive, recover } from './t3-window-driver.mjs';
const { kubectlProxyEnv, registerKubectlProxy, resetKubectlProxyForTests } = proxyMod;

function listenTcp(onSocket) {
  const srv = createServer(onSocket);
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port })));
}

function sendConnect(proxyUrl, authority, delayedPayload = null) {
  const u = new URL(proxyUrl);
  return new Promise((resolve, reject) => {
    const c = connect(Number(u.port), u.hostname, () => {
      c.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`);
      if (delayedPayload) setTimeout(() => { if (!c.destroyed) c.write(delayedPayload); }, 20);
    });
    let out = Buffer.alloc(0);
    c.on('data', chunk => {
      out = Buffer.concat([out, chunk]);
    const text = out.toString('latin1');
    if (text.startsWith('HTTP/1.1 403') || (!delayedPayload && text.includes('\r\n\r\n')) || text.includes('ECHO:')) c.end();
    });
    c.on('close', () => resolve(out.toString('latin1')));
    c.on('error', reject);
  });
}

test('R12 MIN-7: proxy allowlists CONNECT strictly to active kubeconfig server and pauses client during dial', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r12-min7-'));
  let forbiddenHits = 0;
  const forbidden = await listenTcp(s => { forbiddenHits += 1; s.end(); });
  const allowed = await listenTcp(s => s.once('data', d => s.end(`ECHO:${d.toString('latin1')}`)));
  try {
    const kube = join(dir, 'kube.yaml');
    writeFileSync(kube, [
      'apiVersion: v1', 'kind: Config', 'clusters:',
      `- cluster:\n    server: https://127.0.0.1:${forbidden.port}\n  name: other`,
      `- name: active\n  cluster:\n    server: https://127.0.0.1:${allowed.port}`,
      'contexts:',
      '- context:\n    cluster: other\n  name: ctx-other',
      '- name: ctx-active\n  context:\n    cluster: active',
      'current-context: ctx-active', '',
    ].join('\n'), { mode: 0o600 });

    const env = kubectlProxyEnv({}, { kubeconfig: kube });
    assert.match(await sendConnect(env.HTTPS_PROXY, `127.0.0.1:${forbidden.port}`), /^HTTP\/1\.1 403 Forbidden\r\n/);
    assert.equal(forbiddenHits, 0, 'non-allowlisted CONNECT target must never be dialed');
    assert.match(await sendConnect(env.HTTPS_PROXY, `127.0.0.1:${allowed.port}`), /^HTTP\/1\.1 200 Connection Established\r\n/);

    // Verify client.pause() preserves bytes arriving on a separate write while dialBounded awaits.
    const slowDialer = join(dir, 'slow-dialer.mjs');
    writeFileSync(slowDialer, `import { connect } from 'node:net'; import { Duplex, PassThrough } from 'node:stream';
export const createDialer = () => ({ host, port }) => {
  const toReal = new PassThrough(), fromReal = new PassThrough();
  const dup = Object.assign(Duplex.from({ writable: toReal, readable: fromReal }), { setNoDelay() {}, setKeepAlive() {} });
  setTimeout(() => {
    const real = connect({ host, port }, () => { toReal.pipe(real); real.pipe(fromReal); dup.emit('connect'); });
    real.on('error', e => dup.destroy(e)); dup.on('close', () => real.destroy());
  }, 80);
  return dup;
};\n`);
    const slow = registerKubectlProxy({ kubeconfig: kube, dialModule: pathToFileURL(slowDialer).href });
    const echoed = await sendConnect(slow.url, `127.0.0.1:${allowed.port}`, 'PIPELINED-DURING-DIAL');
    assert.match(echoed, /^HTTP\/1\.1 200 Connection Established\r\n\r\nECHO:PIPELINED-DURING-DIAL$/);
    await slow.close();
  } finally {
    await resetKubectlProxyForTests();
    forbidden.srv.close(); allowed.srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R12 MIN-1: proxy Worker error/exit and server error purge cache and raise kubectl_proxy_down while recover() and watchdog fall back to direct dial', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r12-min1-'));
  const base = inputs(), tpl = { spec: { containers: [{ name: 'c', image: 'legacy' }] } }, dig = templateDigest(tpl);
  const templateDigests = { api: dig, 'auth-idp': dig, ui: dig }, apiCtrl = new Int32Array(new SharedArrayBuffer(8));
  const apiWorker = new Worker(`import { createServer } from 'node:net'; import { workerData as w } from 'node:worker_threads';
    const srv = createServer(sock => { Atomics.add(w.ctrl, 1, 1); let buf = ''; sock.on('data', c => {
      buf += c.toString('utf8'); if (!buf.includes('\\n')) return;
      const req = JSON.parse(buf.split('\\n')[0]), [verb, kind] = req.args; let body = '';
      if (verb === 'exec' && req.stdin.includes('journal_present')) body = 'f|0\\n';
      else if (verb === 'get' && kind === 'pods') body = '{"items":[]}';
      else if (verb === 'get' && kind === 'secret') body = '{"data":{}}';
      else if (verb === 'get' && kind === 'deployment') body = w.depJson;
      else if (verb === 'get' && kind === 'cronjob') body = '{"spec":{"suspend":true}}';
      else if (verb === 'auth') body = 'yes\\n';
      sock.end(body); }); });
    srv.listen(0, '127.0.0.1', () => { Atomics.store(w.ctrl, 0, srv.address().port); Atomics.notify(w.ctrl, 0); });`,
    { eval: true, workerData: { ctrl: apiCtrl, depJson: JSON.stringify({ spec: { template: tpl } }) } });
  Atomics.wait(apiCtrl, 0, 0, 5_000);
  const apiPort = Atomics.load(apiCtrl, 0);
  const kube = join(dir, 'kube.yaml');
  writeFileSync(kube, `apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://127.0.0.1:${apiPort}\ncontexts:\n- name: ctx\n  context:\n    cluster: c\ncurrent-context: ctx\n`, { mode: 0o600 });
  const shim = join(dir, 'kubectl');
  writeFileSync(shim, `#!/usr/bin/env node
import { readFileSync } from 'node:fs'; import { connect } from 'node:net';
const a = process.argv.slice(2), i = a.indexOf('--request-timeout=60s'), args = i >= 0 ? a.slice(i + 1) : a;
const kc = a[a.indexOf('--kubeconfig') + 1], hp = /server:\\s*https:\\/\\/([^\\s]+)/.exec(readFileSync(kc, 'utf8'))[1];
const [host, port] = hp.split(':'), stdin = args.includes('-i') ? readFileSync(0, 'utf8') : '';
const run = sock => { sock.write(JSON.stringify({ args, stdin }) + '\\n'); let d = ''; sock.on('data', c => d += c); sock.on('end', () => { process.stdout.write(d); process.exit(0); }); sock.on('error', () => process.exit(1)); };
if (!process.env.HTTPS_PROXY) { const s = connect(Number(port), host, () => run(s)); s.on('error', e => { process.stderr.write(String(e)); process.exit(1); }); }
else { const p = new URL(process.env.HTTPS_PROXY); let ok = false, b = '';
  const s = connect(Number(p.port), p.hostname, () => s.write(\`CONNECT \${hp} HTTP/1.1\\r\\nHost: \${hp}\\r\\n\\r\\n\`));
  s.on('error', e => { process.stderr.write(\`proxyconnect \${p.host}: \${e.code}\`); process.exit(1); });
  s.on('close', () => { if (!ok) { process.stderr.write('proxyconnect: EOF'); process.exit(1); } });
  s.on('data', function onD(c) { b += c.toString('latin1'); const k = b.indexOf('\\r\\n\\r\\n'); if (k < 0) return; s.removeListener('data', onD);
    if (!b.startsWith('HTTP/1.1 200')) { process.stderr.write('proxy_502'); process.exit(1); } ok = true; run(s); }); }
`, { mode: 0o755 });
  chmodSync(shim, 0o755);
  const faultDialer = join(dir, 'fault-dialer.mjs');
  writeFileSync(faultDialer, `import { connect } from 'node:net';
export const createDialer = (mode, server) => ({ host, port }) => {
  const m = Atomics.exchange(mode, 0, 0);
  if (m === 1) setImmediate(() => { throw new Error('worker_uncaught_boom'); });
  if (m === 2) server.emit('error', Object.assign(new Error('EMFILE'), { code: 'EMFILE' }));
  if (m === 3) process.exit(2);
  return connect({ host, port });
};\n`);
  const savedPath = process.env.PATH; process.env.PATH = `${dir}:${savedPath}`;
  try {
    const mode = new Int32Array(new SharedArrayBuffer(4)), dialModule = pathToFileURL(faultDialer).href;
    // 1=uncaught error, 2=server.on('error'), 3=unexpected exit: never crashes host, purges cache, raises kubectl_proxy_down.
    for (const fault of [1, 2, 3]) {
      await resetKubectlProxyForTests();
      registerKubectlProxy({ kubeconfig: kube, dialModule, dialState: mode });
      Atomics.store(mode, 0, fault);
      try { await sendConnect(kubectlProxyEnv({}, { kubeconfig: kube }).HTTPS_PROXY, `127.0.0.1:${apiPort}`); } catch {}
      await new Promise(r => setTimeout(r, 40));
      assert.throws(() => kubectlProxyEnv({}, { kubeconfig: kube }), /kubectl_proxy_down/, `fault=${fault} must raise kubectl_proxy_down`);
    }

    // Driver: dead proxy raises kubectl_proxy_down in nominal W0, then recover() falls back to direct dial and rolls back to DONE (3).
    const drvStateDir = join(dir, 'drv-state');
    const drvCall = runKubectl({ kubeconfig: kube, namespace: 'sentropic-preprod', stateDir: drvStateDir });
    const config = { ...base.config, kubeconfigFile: kube, templateDigests, preCmDir: null };
    const drvCtx = { call: drvCall, config, stateDir: drvStateDir, tier: 'preprod', postgresPod: 'postgres-0',
      probe: async () => new Response('ok', { status: 200 }), print: () => {}, read: base.read };
    assert.equal(await drive(drvCtx), 1);
    assert.equal(loadState(drvStateDir).refusalReason, 'throw:kubectl_proxy_down');
    const hitsBeforeRec = Atomics.load(apiCtrl, 1);
    const recState = { version: 1, step: 'W3', fenceStarted: true, t0MonoMs: monoMs() - 5_000, namespace: 'sentropic-preprod', operationId: 'op-drv' };
    assert.equal(await recover(drvCtx, recState, 'throw:kubectl_proxy_down'), 3);
    assert.equal(loadState(drvStateDir).step, 'DONE');
    assert.ok(Atomics.load(apiCtrl, 1) > hitsBeforeRec, 'recover() reached API server via direct dial after proxy death');

    // Watchdog: mid-call Worker exit during poll() falls back to direct dial and completes rollback to DONE (3).
    await resetKubectlProxyForTests();
    registerKubectlProxy({ kubeconfig: kube, dialModule, dialState: mode });
    Atomics.store(mode, 0, 3); // Worker exits on first CONNECT inside watchdog poll()
    const wdStateDir = join(dir, 'wd-state');
    saveState(wdStateDir, { version: 1, step: 'W3', fenceStarted: true, driverPid: 999999,
      heartbeatMonoMs: monoMs() - 5_000, stepDeadlineMonoMs: monoMs() - 1_000, t0MonoMs: monoMs() - 10_000,
      namespace: 'sentropic-preprod', operationId: 'op-wd' });
    const wdCall = runKubectl({ kubeconfig: kube, namespace: 'sentropic-preprod', stateDir: wdStateDir, proxyFallbackDirect: true });
    const wdCode = await poll({ call: wdCall, config, stateDir: wdStateDir, tier: 'preprod', postgresPod: 'postgres-0',
      probe: async () => new Response('ok', { status: 200 }), print: () => {}, read: base.read });
    assert.equal(wdCode, 3);
    assert.equal(loadState(wdStateDir).watchdogDone, true);
  } finally {
    process.env.PATH = savedPath;
    await resetKubectlProxyForTests();
    await apiWorker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R12 MIN-2: shared CONNECT counter exposed to chrono, W0 tunnel assertion, bypass traces and runbook kill-switch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't3-r12-min2-'));
  const base = inputs(), tpl = { spec: { containers: [{ name: 'c', image: 'legacy' }] } }, dig = templateDigest(tpl);
  const templateDigests = { api: dig, 'auth-idp': dig, ui: dig }, ctrl2 = new Int32Array(new SharedArrayBuffer(4));
  const fullWorker = new Worker(`import { createServer } from 'node:net'; import { workerData as w } from 'node:worker_threads';
    const srv = createServer(sock => { let buf = ''; sock.on('data', c => {
      buf += c.toString('utf8'); if (!buf.includes('\\n')) return;
      const req = JSON.parse(buf.split('\\n')[0]), [verb, kind, name] = req.args; let body = '{}';
      if (verb === 'auth') body = 'yes\\n';
      else if (verb === 'exec') {
        if (req.stdin.includes('SHOW server_version')) body = '17.11\\n';
        else if (req.stdin.includes('AS acl_sha256')) body = 'a'.repeat(64);
        else if (req.stdin.includes('cutover-applicability-v1')) body = w.app;
        else if (req.stdin.includes('AS k,')) body = 'enc-key||3\\n';
      } else if (verb === 'get' && kind === 'secret') body = name === 'a4-verification-auth' ? w.vSec : '{"data":{"EMAIL_VERIFICATION_PEPPER":"eA=="}}';
      else if (verb === 'get' && kind === 'pod') body = JSON.stringify({ status: { containerStatuses: [{ name: 'postgres', imageID: 'docker.io/library/' + w.pgImg }] } });
      else if (verb === 'get' && kind === 'cronjob') body = JSON.stringify({ spec: { suspend: true, jobTemplate: { spec: { template: { spec: { initContainers: [{ name: name === 'pgbackup' ? 'dump' : 'export-sql', image: w.pgTool }] } } } } } });
      else if (verb === 'get' && kind === 'deployment') body = w.depJson;
      sock.end(body); }); });
    srv.listen(0, '127.0.0.1', () => { Atomics.store(w.ctrl, 0, srv.address().port); Atomics.notify(w.ctrl, 0); });`, {
    eval: true,
    workerData: { ctrl: ctrl2, app: JSON.stringify(applicabilityFixture()), vSec: JSON.stringify(verificationSecret),
      pgImg: PROD_POSTGRES_IMAGE, pgTool: PROD_POSTGRES_TOOL_IMAGE, depJson: JSON.stringify({ spec: { template: tpl } }) },
  });
  Atomics.wait(ctrl2, 0, 0, 5_000);
  const port = Atomics.load(ctrl2, 0);
  const kube = join(dir, 'private-kube.yaml');
  writeFileSync(kube, `apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://k8s.gra.ovh.net:${port}\ncontexts:\n- name: ctx\n  context:\n    cluster: c\ncurrent-context: ctx\n`, { mode: 0o600 });
  const localDialer = join(dir, 'local-dialer.mjs');
  writeFileSync(localDialer, `import { connect } from 'node:net';\nexport const createDialer = () => ({ port }) => connect({ host: '127.0.0.1', port });\n`);
  const shim = join(dir, 'kubectl');
  writeFileSync(shim, `#!/usr/bin/env node
import { readFileSync } from 'node:fs'; import { connect } from 'node:net';
const a = process.argv.slice(2), i = a.indexOf('--request-timeout=60s'), args = i >= 0 ? a.slice(i + 1) : a;
const kc = readFileSync(a[a.indexOf('--kubeconfig') + 1], 'utf8'), hp = /server:\\s*https:\\/\\/([^\\s]+)/.exec(kc)[1];
const [, port] = hp.split(':'), stdin = args.includes('-i') ? readFileSync(0, 'utf8') : '';
const noProxy = (process.env.NO_PROXY ?? '').includes('ovh.net') || process.env.NO_PROXY === '*';
const kcProxy = /proxy-url:\\s*\\S+/.test(kc), ignoreProxy = process.env.TEST_SHIM_IGNORE_PROXY === '1';
const run = s => { s.write(JSON.stringify({ args, stdin }) + '\\n'); let d = ''; s.on('data', c => d += c); s.on('end', () => { process.stdout.write(d); process.exit(0); }); };
if (ignoreProxy || noProxy || kcProxy || !process.env.HTTPS_PROXY || process.env.HTTPS_PROXY.includes('external-corp')) {
  const s = connect(Number(port), '127.0.0.1', () => run(s));
} else {
  const p = new URL(process.env.HTTPS_PROXY), s = connect(Number(p.port), p.hostname, () => s.write(\`CONNECT \${hp} HTTP/1.1\\r\\nHost: \${hp}\\r\\n\\r\\n\`));
  let b = ''; s.on('data', function onD(c) { b += c.toString('latin1'); if (!b.includes('\\r\\n\\r\\n')) return; s.removeListener('data', onD); run(s); });
}\n`, { mode: 0o755 });
  chmodSync(shim, 0o755);
  const saved = { PATH: process.env.PATH, T3_CHRONO_FILE: process.env.T3_CHRONO_FILE };
  process.env.PATH = `${dir}:${saved.PATH}`;
  try {
    const dialModule = pathToFileURL(localDialer).href;
    await resetKubectlProxyForTests();
    registerKubectlProxy({ kubeconfig: kube, dialModule });
    const chronoFile = join(dir, 'chrono.jsonl');
    process.env.T3_CHRONO_FILE = chronoFile;
    kubectl(kube, ['auth', 'can-i', 'get', 'pods'], undefined, 'sentropic-preprod');
    const summary1 = summarize(readFileSync(chronoFile, 'utf8'));
    assert.equal(summary1.proxyConnects, 1);
    assert.doesNotMatch(readFileSync(chronoFile, 'utf8'), /private-kube/);

    const baselinePath = join(dir, 'baseline.json');
    writeFileSync(baselinePath, base.files['/baseline'], { mode: 0o600 });
    const makeDrv = (stateSub, kubePath = kube, extraPrint = []) => {
      const sd = join(dir, stateSub);
      const call = runKubectl({ kubeconfig: kubePath, namespace: 'sentropic-preprod', stateDir: sd });
      const config = { ...base.config, kubeconfigFile: kubePath, applicabilityBaselineFile: baselinePath, templateDigests, preCmDir: null };
      return { sd, extraPrint, ctx: { call, config, stateDir: sd, tier: 'preprod', postgresPod: 'postgres-0',
        probe: async () => new Response('ok', { status: 200 }), print: m => extraPrint.push(m), read: base.read,
        delivered: c => { saveState(c.stateDir, { ...loadState(c.stateDir), fenceStarted: false }); throw new Error('stop_at_w1'); } } };
    };
    delete process.env.T3_CHRONO_FILE;

    // 1. Active tunnel passes W0 checkDialProxy and sets t0MonoMs before W1.
    const okRun = makeDrv('w0-ok');
    await drive(okRun.ctx);
    assert.equal(typeof loadState(okRun.sd).t0MonoMs, 'number', 'W0 passed with active tunnel');
    const okSummary = summarize(readFileSync(join(okRun.sd, 't3-chrono.jsonl'), 'utf8'));
    assert.ok(okSummary.proxyConnects >= 1);

    // 2. Unexplained zero-CONNECT tunnel bypass fails closed in W0 before t0.
    process.env.TEST_SHIM_IGNORE_PROXY = '1';
    try {
      const badRun = makeDrv('w0-unverified');
      assert.equal(await drive(badRun.ctx), 1);
      assert.equal(loadState(badRun.sd).t0MonoMs, undefined);
      assert.equal(loadState(badRun.sd).refusalReason, 'throw:kubectl_proxy_unverified');
    } finally { delete process.env.TEST_SHIM_IGNORE_PROXY; }

    // 3. Explicit overrides emit dialProxy: bypassed(<reason>).
    const kubeProxy = join(dir, 'kube-proxy.yaml');
    writeFileSync(kubeProxy, readFileSync(kube, 'utf8').replace('clusters:\n- name: c\n  cluster:\n', 'clusters:\n- name: c\n  cluster:\n    proxy-url: http://corp:3128\n'), { mode: 0o600 });
    for (const [label, envPatch, kcPath] of [
      ['disabled', { T3_KUBECTL_PROXY_DISABLE: '1' }, kube],
      ['https_proxy', { HTTPS_PROXY: 'http://external-corp:8080' }, kube],
      ['no_proxy', { NO_PROXY: '*.ovh.net' }, kube],
      ['kubeconfig_proxy_url', {}, kubeProxy],
    ]) {
      await resetKubectlProxyForTests();
      registerKubectlProxy({ kubeconfig: kcPath, dialModule });
      Object.assign(process.env, envPatch);
      try {
        const bRun = makeDrv(`w0-${label}`, kcPath);
        await drive(bRun.ctx);
        assert.ok(bRun.extraPrint.includes(`dialProxy: bypassed(${label})`), `expected dialProxy: bypassed(${label}), got ${bRun.extraPrint.join(',')}`);
      } finally {
        for (const k of Object.keys(envPatch)) delete process.env[k];
      }
    }

    const runbook = readFileSync(new URL('../../../docs/runbooks/t3-window.md', import.meta.url), 'utf8');
    assert.match(runbook, /T3_KUBECTL_PROXY_DISABLE=1/);
    assert.match(runbook, /dialProxy: bypassed\(/);
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.T3_CHRONO_FILE === undefined) delete process.env.T3_CHRONO_FILE; else process.env.T3_CHRONO_FILE = saved.T3_CHRONO_FILE;
    await resetKubectlProxyForTests();
    await fullWorker.terminate();
    rmSync(dir, { recursive: true, force: true });
  }
});
