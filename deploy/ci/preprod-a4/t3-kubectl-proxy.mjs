import { connect, createServer } from 'node:net';
import { unlinkSync } from 'node:fs';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

export const KUBECTL_DIAL_TIMEOUT_MS = 2_000;
export const KUBECTL_DIAL_MAX_ATTEMPTS = 3;
const RETRYABLE_DIAL_CODES = new Set([
  'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN',
]);

function parseAuthority(authority) {
  const m = /^(\[[^\]]+\]|[^:\s]+):(\d+)$/.exec(authority ?? '');
  if (!m) return null;
  const port = Number(m[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { host: m[1].replace(/^\[|\]$/g, ''), port };
}

function dialOnce(host, port, timeoutMs, stallOnceFile) {
  if (stallOnceFile) {
    let claimed = false;
    try { unlinkSync(stallOnceFile); claimed = true; } catch { /* absent */ }
    if (claimed) {
      return new Promise((_, reject) => setTimeout(
        () => reject(Object.assign(new Error('dial_timeout'), { code: 'ETIMEDOUT' })), timeoutMs));
    }
  }
  return new Promise((resolve, reject) => {
    const sock = connect({ host, port });
    let done = false;
    const fail = err => {
      if (done) return;
      done = true; clearTimeout(timer); sock.destroy(); reject(err);
    };
    const timer = setTimeout(() => fail(Object.assign(new Error('dial_timeout'), { code: 'ETIMEDOUT' })), timeoutMs);
    sock.once('error', fail);
    sock.once('connect', () => {
      if (done) { sock.destroy(); return; }
      done = true; clearTimeout(timer); sock.removeListener('error', fail); resolve(sock);
    });
  });
}

async function dialBounded(host, port, clientSocket, cfg) {
  let lastErr = null;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
    if (clientSocket.destroyed) throw new Error('client_closed');
    try {
      return await dialOnce(host, port, cfg.dialTimeoutMs, cfg.stallOnceFile);
    } catch (err) {
      lastErr = err;
      if (attempt >= cfg.maxAttempts || !RETRYABLE_DIAL_CODES.has(err?.code)) throw err;
    }
  }
  throw lastErr ?? new Error('dial_failed');
}

function runProxyWorker(cfg) {
  const override = cfg.testTarget ? parseAuthority(cfg.testTarget) : null;
  const server = createServer(client => {
    client.setNoDelay(true);
    let buf = Buffer.alloc(0), connected = false;
    const hdrTimer = setTimeout(() => { if (!connected) client.destroy(); }, 5_000);
    const onData = async chunk => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) { if (buf.length > 16_384) client.destroy(); return; }
      client.removeListener('data', onData);
      clearTimeout(hdrTimer);
      const firstLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
      const m = /^CONNECT ([^\s]+) HTTP\/1\.[01]$/.exec(firstLine);
      const target = m ? parseAuthority(m[1]) : null;
      if (!target) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
      const dest = override && target.host === 'apiserver.t3.local' ? override : target;
      const head = buf.subarray(idx + 4);
      try {
        const upstream = await dialBounded(dest.host, dest.port, client, cfg);
        if (client.destroyed) { upstream.destroy(); return; }
        connected = true;
        upstream.setNoDelay(true);
        upstream.setKeepAlive(true, 10_000);
        // Strictly after upstream TCP establishment: once 200 is written, TLS/HTTP/SPDY
        // bytes flow and any failure propagates directly without retry.
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
        const closeBoth = () => { client.destroy(); upstream.destroy(); };
        client.on('error', closeBoth); upstream.on('error', closeBoth);
        client.on('close', () => upstream.destroy()); upstream.on('close', () => client.destroy());
      } catch {
        if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
      }
    };
    client.on('error', () => clearTimeout(hdrTimer));
    client.on('data', onData);
  });
  server.listen(0, '127.0.0.1', () => {
    Atomics.store(cfg.state, 1, server.address().port);
    Atomics.store(cfg.state, 0, 1);
    Atomics.notify(cfg.state, 0);
  });
}

if (!isMainThread && workerData?.t3KubectlProxy) runProxyWorker(workerData);

const workers = new Map();
function ensureProxyWorker(env) {
  const testTarget = env.T3_KUBECTL_PROXY_TEST_TARGET ?? '';
  const stallOnceFile = env.T3_KUBECTL_PROXY_STALL_ONCE_FILE ?? '';
  const key = `${testTarget}|${stallOnceFile}`;
  if (workers.has(key)) return workers.get(key);
  const state = new Int32Array(new SharedArrayBuffer(8));
  const worker = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: { t3KubectlProxy: true, state, dialTimeoutMs: KUBECTL_DIAL_TIMEOUT_MS,
      maxAttempts: KUBECTL_DIAL_MAX_ATTEMPTS, testTarget, stallOnceFile },
  });
  worker.unref();
  Atomics.wait(state, 0, 0, 5_000);
  if (Atomics.load(state, 0) !== 1) throw new Error('kubectl_proxy_start_failed');
  const url = `http://127.0.0.1:${Atomics.load(state, 1)}`;
  workers.set(key, url);
  return url;
}

export function stripOwnedProxyEnv(env = process.env) {
  const next = { ...env };
  const owned = next.T3_KUBECTL_PROXY_URL;
  delete next.T3_KUBECTL_PROXY_URL;
  if (owned && next.HTTPS_PROXY === owned) delete next.HTTPS_PROXY;
  if (owned && next.https_proxy === owned) delete next.https_proxy;
  return next;
}

export function kubectlProxyEnv(env = process.env) {
  if (env.T3_KUBECTL_PROXY_DISABLE === '1') return stripOwnedProxyEnv(env);
  if (env.HTTPS_PROXY && env.HTTPS_PROXY !== env.T3_KUBECTL_PROXY_URL) return env;
  if (env.https_proxy && env.https_proxy !== env.T3_KUBECTL_PROXY_URL) return env;
  const url = (env.T3_KUBECTL_PROXY_URL && !env.T3_KUBECTL_PROXY_TEST_TARGET)
    ? env.T3_KUBECTL_PROXY_URL
    : ensureProxyWorker(env);
  return { ...env, T3_KUBECTL_PROXY_URL: url, HTTPS_PROXY: url, https_proxy: url };
}
