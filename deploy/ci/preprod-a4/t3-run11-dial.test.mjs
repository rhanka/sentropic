import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:https';
import { existsSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { isMainThread, Worker, workerData } from 'node:worker_threads';
import { kubectl } from './guards.mjs';
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

function runMockKubeWorker({ ctrl, candidateImage }) {
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
  server.listen(0, '127.0.0.1', () => {
    Atomics.store(ctrl, 1, server.address().port);
    Atomics.store(ctrl, 0, 1);
    Atomics.notify(ctrl, 0);
  });
}

const kubeconfigYaml = hp => `apiVersion: v1\nkind: Config\nclusters:\n- name: c\n  cluster:\n    server: https://${hp}\n    insecure-skip-tls-verify: true\nusers:\n- name: u\n  user:\n    token: synthetic-token\ncontexts:\n- name: ctx\n  context:\n    cluster: c\n    user: u\ncurrent-context: ctx\n`;

if (!isMainThread && workerData?.mockKube) runMockKubeWorker(workerData);
else test('R11 dial stall: <=3s pre-establishment TCP dial retry recovers W0 and W7b exec -i, never retries mid-stream, and measures overhead', async () => {
  const realKubectl = process.env.T3_REAL_KUBECTL ?? '/opt/t3-kubectl/kubectl';
  assert.ok(existsSync(realKubectl), `pinned kubectl required at ${realKubectl}`);
  const dir = mkdtempSync(join(tmpdir(), 't3-r11-dial-')), candidate = `ghcr.io/rhanka/sentropic-api@sha256:${'e'.repeat(64)}`;
  symlinkSync(realKubectl, join(dir, 'kubectl'));
  const ctrl = new Int32Array(new SharedArrayBuffer(20));
  const apiWorker = new Worker(new URL(import.meta.url), { workerData: { mockKube: true, ctrl, candidateImage: candidate } });
  Atomics.wait(ctrl, 0, 0, 5_000);
  const port = Atomics.load(ctrl, 1), proxyKube = join(dir, 'kube-proxy.yaml'), directKube = join(dir, 'kube-direct.yaml'), stallOnce = join(dir, 'stall-once');
  writeFileSync(proxyKube, kubeconfigYaml(`apiserver.t3.local:${port}`), { mode: 0o600 });
  writeFileSync(directKube, kubeconfigYaml(`127.0.0.1:${port}`), { mode: 0o600 });
  const saved = { PATH: process.env.PATH, target: process.env.T3_KUBECTL_PROXY_TEST_TARGET, stall: process.env.T3_KUBECTL_PROXY_STALL_ONCE_FILE, disable: process.env.T3_KUBECTL_PROXY_DISABLE };
  process.env.PATH = `${dir}:${saved.PATH}`;
  process.env.T3_KUBECTL_PROXY_TEST_TARGET = `127.0.0.1:${port}`;
  process.env.T3_KUBECTL_PROXY_STALL_ONCE_FILE = stallOnce;
  try {
    writeFileSync(stallOnce, '1');
    const tW0 = performance.now();
    assert.equal(kubectl(proxyKube, ['auth', 'can-i', 'get', 'deployments'], undefined, 'sentropic-preprod').trim(), 'yes');
    const elapsedW0 = performance.now() - tW0;
    assert.ok(elapsedW0 >= 1_800 && elapsedW0 < 3_500, `expected ~2s fast-dial retry on W0, got ${elapsedW0}ms`);
    const call = runKubectl({ kubeconfig: proxyKube, namespace: 'sentropic-preprod', stateDir: dir });
    writeFileSync(stallOnce, '1');
    const tW7b = performance.now(), info = classify({ call, postgresPod: 'postgres-0', config: { candidateImage: candidate } });
    const elapsedW7b = performance.now() - tW7b;
    assert.ok(elapsedW7b >= 1_800 && elapsedW7b < 3_500, `expected ~2s fast-dial retry on W7b exec -i, got ${elapsedW7b}ms`);
    assert.deepEqual([info.journal, info.locks, info.committed, info.apiReady], [true, 0, true, true]);
    Atomics.store(ctrl, 2, 0); Atomics.store(ctrl, 4, 1);
    assert.throws(() => call(['patch', 'secret', 'sentropic-api', '--type=merge', '-p', '{"stringData":{"k":"v"}}']), /kubectl_failed/);
    assert.equal(Atomics.load(ctrl, 2), 1, 'mid-stream mutation failure must never be retried');
    Atomics.store(ctrl, 3, 0); Atomics.store(ctrl, 4, 2);
    assert.throws(() => classify({ call, postgresPod: 'postgres-0', config: { candidateImage: candidate } }), /kubectl_failed/);
    assert.equal(Atomics.load(ctrl, 3), 1, 'mid-stream W7b exec -i failure after stream start must never be retried');
    Atomics.store(ctrl, 4, 0);
    try { unlinkSync(stallOnce); } catch { /* absent */ }
    const directCall = runKubectl({ kubeconfig: directKube, namespace: 'sentropic-preprod', stateDir: dir });
    directCall(['auth', 'can-i', 'get', 'pods']); call(['auth', 'can-i', 'get', 'pods']);
    const sample = fn => { const a = []; for (let i = 0; i < 30; i++) { const s = performance.now(); fn(); a.push(performance.now() - s); } return a.sort((x, y) => x - y); };
    process.env.T3_KUBECTL_PROXY_DISABLE = '1'; const directMs = sample(() => directCall(['auth', 'can-i', 'get', 'pods']));
    delete process.env.T3_KUBECTL_PROXY_DISABLE; const proxyMs = sample(() => call(['auth', 'can-i', 'get', 'pods']));
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length, deltaMed = proxyMs[15] - directMs[15], deltaMean = mean(proxyMs) - mean(directMs);
    console.log(`# dial_proxy_overhead_ms n=30 directMedian=${directMs[15].toFixed(2)} proxyMedian=${proxyMs[15].toFixed(2)} deltaMedian=${deltaMed.toFixed(2)} deltaMean=${deltaMean.toFixed(2)}`);
    assert.ok(deltaMed < 15, `per-call median overhead too high: ${deltaMed.toFixed(2)}ms`);
  } finally {
    await apiWorker.terminate();
    process.env.PATH = saved.PATH;
    for (const [k, v] of [['T3_KUBECTL_PROXY_TEST_TARGET', saved.target], ['T3_KUBECTL_PROXY_STALL_ONCE_FILE', saved.stall], ['T3_KUBECTL_PROXY_DISABLE', saved.disable]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
