import assert from 'node:assert/strict';
import { connect, createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { kubectlProxyEnv, registerKubectlProxy, resetKubectlProxyForTests } from './t3-kubectl-proxy.mjs';

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
