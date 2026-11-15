import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:https';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { isMainThread, Worker, workerData } from 'node:worker_threads';
import { kubectl } from './guards.mjs';
import * as proxyMod from './t3-kubectl-proxy.mjs';
import { runKubectl } from './t3-lib.mjs';
import { classify } from './t3-window-driver.mjs';

const der = (tag, body) => Buffer.concat([Buffer.of(tag), body.length < 128 ? Buffer.of(body.length)
  : body.length < 256 ? Buffer.of(0x81, body.length) : Buffer.of(0x82, body.length >> 8, body.length & 0xff), body]);
function ephemeralTlsIdentity() {
  const alg = der(0x30, Buffer.from('06032b6570', 'hex'));
  const cn = der(0x30, der(0x31, der(0x30, Buffer.concat([Buffer.from('0603550403', 'hex'), der(0x0c, Buffer.from('apiserver.t3.local'))]))));
  const val = der(0x30, Buffer.concat([der(0x17, Buffer.from('250101000000Z')), der(0x17, Buffer.from('350101000000Z'))]));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const tbs = der(0x30, Buffer.concat([der(0xa0, Buffer.from('020102', 'hex')), der(0x02, Buffer.of(1)), alg, cn, val, cn,
    publicKey.export({ type: 'spki', format: 'der' })]));
  const cert = der(0x30, Buffer.concat([tbs, alg, der(0x03, Buffer.concat([Buffer.of(0), sign(null, tbs, privateKey)]))]));
  return { cert: `-----BEGIN CERTIFICATE-----\n${cert.toString('base64')}\n-----END CERTIFICATE-----\n`,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}
const wsFrame = (ch, text) => { const p = Buffer.concat([Buffer.of(ch), Buffer.from(text)]); return Buffer.concat([Buffer.of(0x82, p.length), p]); };
function readWsStdin(buf) {
  let off = 0, sql = '', eof = false;
  while (off + 2 <= buf.length) {
    const masked = (buf[off + 1] & 0x80) !== 0; let len = buf[off + 1] & 0x7f, hdr = 2;
    if (len === 126) { if (off + 4 > buf.length) break; len = buf.readUInt16BE(off + 2); hdr = 4; }
    const total = hdr + (masked ? 4 : 0) + len;
    if (off + total > buf.length) break;
    const payload = Buffer.from(buf.subarray(off + hdr + (masked ? 4 : 0), off + total));
    if (masked) for (let i = 0; i < len; i++) payload[i] ^= buf[off + hdr + (i & 3)];
    if (payload[0] === 0 && payload.length > 1) sql += payload.subarray(1).toString('utf8');
    if (payload[0] === 255 || (buf[off] & 0x0f) === 8) eof = true;
    off += total;
  }
  return { rest: buf.subarray(off), sql, eof };
}

function runMockKubeWorker({ ctrl, candidateImage, bindHost = '127.0.0.1' }) {
  const server = createServer(ephemeralTlsIdentity(), (req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      if (req.method === 'PATCH') {
        Atomics.add(ctrl, 2, 1);
        if (Atomics.load(ctrl, 4) === 1) { req.socket.destroy(); return; }
      }
      const u = req.url.split('?')[0];
      res.setHeader('content-type', 'application/json');
      if (u === '/api') res.end(JSON.stringify({ kind: 'APIVersions', versions: ['v1'] }));
      else if (u === '/apis') res.end(JSON.stringify({ kind: 'APIGroupList', apiVersion: 'v1', groups: [{ name: 'apps', versions: [{ groupVersion: 'apps/v1', version: 'v1' }], preferredVersion: { groupVersion: 'apps/v1', version: 'v1' } }] }));
      else if (u === '/api/v1') res.end(JSON.stringify({ kind: 'APIResourceList', groupVersion: 'v1', resources: [{ name: 'pods', singularName: 'pod', namespaced: true, kind: 'Pod', verbs: ['get', 'list', 'create'] }, { name: 'pods/exec', singularName: '', namespaced: true, kind: 'PodExecOptions', verbs: ['create', 'get'] }, { name: 'secrets', singularName: 'secret', namespaced: true, kind: 'Secret', verbs: ['get', 'patch'] }] }));
      else if (u === '/apis/apps/v1') res.end(JSON.stringify({ kind: 'APIResourceList', apiVersion: 'v1', groupVersion: 'apps/v1', resources: [{ name: 'deployments', singularName: 'deployment', namespaced: true, kind: 'Deployment', verbs: ['get', 'list', 'patch'] }] }));
      else if (u.includes('/selfsubjectaccessreviews')) res.end(JSON.stringify({ apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectAccessReview', status: { allowed: true } }));
      else if (u.includes('/deployments/api')) res.end(JSON.stringify({ apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', generation: 3 }, spec: { replicas: 1, template: { spec: { containers: [{ name: 'api', image: candidateImage }] } } }, status: { replicas: 1, readyReplicas: 1, observedGeneration: 3 } }));
      else if (u.includes('/pods/postgres-0')) res.end(JSON.stringify({ apiVersion: 'v1', kind: 'Pod', metadata: { name: 'postgres-0', namespace: 'sentropic-preprod' }, spec: { containers: [{ name: 'postgres' }] }, status: { phase: 'Running' } }));
      else res.end(JSON.stringify({ apiVersion: 'v1', kind: 'Secret', metadata: { name: 'sentropic-api' } }));
    });
  });
  server.on('upgrade', (req, socket) => {
    Atomics.add(ctrl, 3, 1);
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Protocol: v5.channel.k8s.io\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.write(Buffer.of(0x82, 1, 1));
    let buf = Buffer.alloc(0), fullSql = '';
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      const parsed = readWsStdin(buf); buf = parsed.rest; fullSql += parsed.sql;
      if (Atomics.load(ctrl, 4) === 2 && fullSql.length > 0) { socket.destroy(); return; }
      if (parsed.eof) {
        const out = fullSql.includes('journal_present') ? 't|0\n' : fullSql.includes('identity_committed') ? 't\n'
          : fullSql.includes('asset_column_present') ? 'f\n' : 'control.artifact_host_kv|t\n';
        socket.write(wsFrame(1, out));
        socket.write(wsFrame(3, '{"metadata":{},"status":"Success"}'));
        socket.end(Buffer.from([0x88, 0x02, 0x03, 0xe8]));
      }
    });
  });
  server.listen(0, bindHost, () => {
    Atomics.store(ctrl, 1, server.address().port);
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
  });
}

const kubeconfigYaml = hp => `apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://${hp}\n    insecure-skip-tls-verify: true\nusers:\n- name: u\n  user:\n    token: synthetic-token\ncontexts:\n- name: ctx\n  context:\n    cluster: c\n    user: u\ncurrent-context: ctx\n`;

const NODE_KUBECTL_SHIM = `#!/usr/bin/env node
import { readFileSync } from 'node:fs'; import { request } from 'node:https'; import { connect } from 'node:net'; import { connect as tlsConnect } from 'node:tls';
const args = process.argv.slice(2), rest = []; let kc = '';
for (let i = 0; i < args.length; i++) { if (args[i] === '--kubeconfig' || args[i] === '--namespace') { if (args[i] === '--kubeconfig') kc = args[i + 1]; i++; } else if (!args[i].startsWith('--request-timeout=')) rest.push(args[i]); }
const auth = /server:\\s*https:\\/\\/([^\\s]+)/.exec(readFileSync(kc, 'utf8'))[1], [host, portStr] = auth.split(':'), port = Number(portStr);
const openTls = () => new Promise((res, rej) => {
  const up = raw => { const s = tlsConnect({ socket: raw, rejectUnauthorized: false }, () => res(s)); s.on('error', rej); };
  if (!process.env.HTTPS_PROXY) { const raw = connect(port, host, () => up(raw)); raw.on('error', rej); return; }
  const p = new URL(process.env.HTTPS_PROXY), raw = connect(Number(p.port), p.hostname, () => raw.write(\`CONNECT \${auth} HTTP/1.1\\r\\nHost: \${auth}\\r\\n\\r\\n\`));
  let b = Buffer.alloc(0); raw.on('error', rej);
  raw.on('data', function onD(c) { b = Buffer.concat([b, c]); const i = b.indexOf('\\r\\n\\r\\n'); if (i < 0) return; raw.removeListener('data', onD);
    if (!b.subarray(0, i).toString().startsWith('HTTP/1.1 200')) { raw.destroy(); rej(new Error('proxy_502')); return; } up(raw); });
});
const maskFrame = p => { const h = p.length < 126 ? Buffer.of(0x82, 0x80 | p.length) : Buffer.of(0x82, 0xfe, p.length >> 8, p.length & 0xff); return Buffer.concat([h, Buffer.alloc(4), p]); };
const sock = await openTls();
if (rest[0] === 'exec') {
  const stdin = readFileSync(0); sock.write(\`GET /api/v1/namespaces/sentropic-preprod/pods/postgres-0/exec HTTP/1.1\\r\\nHost: \${auth}\\r\\nConnection: Upgrade\\r\\nUpgrade: websocket\\r\\nSec-WebSocket-Version: 13\\r\\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\\r\\nSec-WebSocket-Protocol: v5.channel.k8s.io\\r\\n\\r\\n\`);
  let b = Buffer.alloc(0), up = false, out = '', ok = false;
  sock.on('data', c => { b = Buffer.concat([b, c]); if (!up) { const i = b.indexOf('\\r\\n\\r\\n'); if (i < 0) return; up = true; b = b.subarray(i + 4); sock.write(maskFrame(Buffer.concat([Buffer.of(0), stdin]))); sock.write(maskFrame(Buffer.of(255))); }
    while (b.length >= 2) { const op = b[0] & 0x0f, len = b[1] & 0x7f; if (b.length < 2 + len) break; const f = b.subarray(2, 2 + len); b = b.subarray(2 + len); if (op === 8) { sock.end(); break; } if (f[0] === 1 && f.length > 1) out += f.subarray(1).toString(); if (f[0] === 3 && f.subarray(1).toString().includes('"Success"')) ok = true; } });
  sock.on('close', () => { if (!ok) process.exit(1); process.stdout.write(out); process.exit(0); }); sock.on('error', () => process.exit(1));
} else {
  const [method, path] = rest[0] === 'auth' ? ['POST', '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews'] : rest[0] === 'patch' ? ['PATCH', '/api/v1/secrets/sentropic-api'] : ['GET', '/apis/apps/v1/deployments/api'];
  const req = request({ host, port, method, path, headers: { connection: 'close' }, createConnection: () => sock, rejectUnauthorized: false }, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { if (r.statusCode !== 200) process.exit(1); process.stdout.write(rest[0] === 'auth' ? 'yes\\n' : d); process.exit(0); }); });
  req.on('error', () => process.exit(1)); req.end(rest[0] === 'patch' ? rest.at(-1) : '');
}
`;

if (!isMainThread && workerData?.mockKube) runMockKubeWorker(workerData);
else test('R11/R12 MIN-3 dial stall: workerData dial injection exercises real dialOnce timeout + sock.destroy(), recovers W0 and W7b exec -i without production test env hooks, and never retries mid-stream', async () => {
  const prodSource = readFileSync(new URL('./t3-kubectl-proxy.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(prodSource, /T3_KUBECTL_PROXY_TEST_TARGET|T3_KUBECTL_PROXY_STALL_ONCE_FILE/);
  assert.equal(typeof proxyMod.registerKubectlProxy, 'function');
  if (process.env.T3_REAL_KUBECTL) assert.ok(existsSync(process.env.T3_REAL_KUBECTL), `pinned kubectl required at ${process.env.T3_REAL_KUBECTL}`);
  const realKubectl = process.env.T3_REAL_KUBECTL ?? '/opt/t3-kubectl/kubectl';
  const dir = mkdtempSync(join(tmpdir(), 't3-r11-dial-')), candidate = `ghcr.io/rhanka/sentropic-api@sha256:${'e'.repeat(64)}`;
  if (existsSync(realKubectl)) symlinkSync(realKubectl, join(dir, 'kubectl'));
  else writeFileSync(join(dir, 'kubectl'), NODE_KUBECTL_SHIM, { mode: 0o700 });
  const bindHost = Object.values(networkInterfaces()).flat().find(i => !i.internal && i.family === 'IPv4')?.address ?? '127.0.0.1';
  const kubeHost = bindHost === '127.0.0.1' ? 'apiserver.t3.local' : bindHost;
  const dialerFile = join(dir, 'dialer.mjs');
  writeFileSync(dialerFile, `import { connect, Socket } from 'node:net';
export const createDialer = s => ({ host, port }) => {
  Atomics.add(s, 1, 1); const left = Atomics.load(s, 0);
  if (left > 0 && Atomics.compareExchange(s, 0, left, left - 1) === left) { const k = new Socket(); k.on('close', () => Atomics.add(s, 2, 1)); return k; }
  return connect({ host: host === 'apiserver.t3.local' ? '127.0.0.1' : host, port });
};\n`);
  const ctrl = new Int32Array(new SharedArrayBuffer(20)), dialState = new Int32Array(new SharedArrayBuffer(16));
  const apiWorker = new Worker(new URL(import.meta.url), { workerData: { mockKube: true, ctrl, candidateImage: candidate, bindHost } });
  Atomics.wait(ctrl, 0, 0, 5_000);
  const port = Atomics.load(ctrl, 1), kube = join(dir, 'kube.yaml'), dialModule = pathToFileURL(dialerFile).href;
  writeFileSync(kube, kubeconfigYaml(`${kubeHost}:${port}`), { mode: 0o600 });
  const saved = { PATH: process.env.PATH, disable: process.env.T3_KUBECTL_PROXY_DISABLE };
  process.env.PATH = `${dir}:${saved.PATH}`; delete process.env.T3_KUBECTL_PROXY_DISABLE;
  try {
    const singleTry = proxyMod.registerKubectlProxy({ kubeconfig: kube, dialModule, dialState, dialTimeoutMs: 250, maxAttempts: 1 });
    Atomics.store(dialState, 0, 99); Atomics.store(dialState, 1, 0); Atomics.store(dialState, 2, 0);
    assert.throws(() => kubectl(kube, ['auth', 'can-i', 'get', 'deployments'], undefined, 'sentropic-preprod'), /kubectl_failed/);
    assert.ok(Atomics.load(dialState, 1) >= 1 && Atomics.load(dialState, 2) === Atomics.load(dialState, 1),
      'every stalled socket destroyed by real dialOnce timer');
    await singleTry.close();

    const injected = proxyMod.registerKubectlProxy({ kubeconfig: kube, dialModule, dialState });
    Atomics.store(dialState, 0, 1); Atomics.store(dialState, 1, 0); Atomics.store(dialState, 2, 0);
    const tW0 = performance.now();
    assert.equal(kubectl(kube, ['auth', 'can-i', 'get', 'deployments'], undefined, 'sentropic-preprod').trim(), 'yes');
    const elapsedW0 = performance.now() - tW0;
    assert.ok(elapsedW0 >= 1_800 && elapsedW0 < 3_500, `expected ~2s fast-dial retry on W0, got ${elapsedW0}ms`);
    assert.ok(Atomics.load(dialState, 1) >= 2); assert.equal(Atomics.load(dialState, 2), 1);
    const call = runKubectl({ kubeconfig: kube, namespace: 'sentropic-preprod', stateDir: dir });
    Atomics.store(dialState, 0, 1); Atomics.store(dialState, 2, 0);
    const tW7b = performance.now(), info = classify({ call, postgresPod: 'postgres-0', config: { candidateImage: candidate } });
    const elapsedW7b = performance.now() - tW7b;
    assert.ok(elapsedW7b >= 1_800 && elapsedW7b < 3_500, `expected ~2s fast-dial retry on W7b exec -i, got ${elapsedW7b}ms`);
    assert.equal(Atomics.load(dialState, 2), 1);
    assert.deepEqual([info.journal, info.locks, info.committed, info.apiReady], [true, 0, true, true]);
    Atomics.store(ctrl, 2, 0); Atomics.store(ctrl, 4, 1);
    assert.throws(() => call(['patch', 'secret', 'sentropic-api', '--type=merge', '-p', '{"stringData":{"k":"v"}}']), /kubectl_failed/);
    assert.equal(Atomics.load(ctrl, 2), 1, 'mid-stream mutation failure must never be retried');
    Atomics.store(ctrl, 3, 0); Atomics.store(ctrl, 4, 2);
    assert.throws(() => classify({ call, postgresPod: 'postgres-0', config: { candidateImage: candidate } }), /kubectl_failed/);
    assert.equal(Atomics.load(ctrl, 3), 1, 'mid-stream W7b exec -i failure after stream start must never be retried');
    Atomics.store(ctrl, 4, 0);
    await injected.close();

    const benchCall = runKubectl({ kubeconfig: kube, namespace: 'sentropic-preprod', stateDir: dir });
    process.env.T3_KUBECTL_PROXY_DISABLE = '1'; benchCall(['auth', 'can-i', 'get', 'pods']);
    delete process.env.T3_KUBECTL_PROXY_DISABLE; benchCall(['auth', 'can-i', 'get', 'pods']);
    const sample = fn => { const a = []; for (let i = 0; i < 30; i++) { const s = performance.now(); fn(); a.push(performance.now() - s); } return a.sort((x, y) => x - y); };
    process.env.T3_KUBECTL_PROXY_DISABLE = '1'; const directMs = sample(() => benchCall(['auth', 'can-i', 'get', 'pods']));
    delete process.env.T3_KUBECTL_PROXY_DISABLE; const proxyMs = sample(() => benchCall(['auth', 'can-i', 'get', 'pods']));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length, deltaMed = proxyMs[15] - directMs[15], deltaMean = mean(proxyMs) - mean(directMs);
    console.log(`# dial_proxy_overhead_ms n=30 directMedian=${directMs[15].toFixed(2)} proxyMedian=${proxyMs[15].toFixed(2)} deltaMedian=${deltaMed.toFixed(2)} deltaMean=${deltaMean.toFixed(2)}`);
    assert.ok(deltaMed < 15, `per-call median overhead too high: ${deltaMed.toFixed(2)}ms`);
  } finally {
    await proxyMod.resetKubectlProxyForTests?.();
    await apiWorker.terminate();
    process.env.PATH = saved.PATH;
    if (saved.disable === undefined) delete process.env.T3_KUBECTL_PROXY_DISABLE; else process.env.T3_KUBECTL_PROXY_DISABLE = saved.disable;
    rmSync(dir, { recursive: true, force: true });
  }
});
