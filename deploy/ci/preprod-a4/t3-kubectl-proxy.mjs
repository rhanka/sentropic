import { connect, createServer } from 'node:net';
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

function dialOnce(host, port, timeoutMs, dial) {
  return new Promise((resolve, reject) => {
    const sock = dial({ host, port });
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

async function dialBounded(host, port, clientSocket, cfg, dial) {
  let lastErr = null;
  for (let attempt = 1; attempt <= cfg.maxAttempts; attempt += 1) {
    if (clientSocket.destroyed) throw new Error('client_closed');
    try {
      return await dialOnce(host, port, cfg.dialTimeoutMs, dial);
    } catch (err) {
      lastErr = err;
      if (attempt >= cfg.maxAttempts || !RETRYABLE_DIAL_CODES.has(err?.code)) throw err;
    }
  }
  throw lastErr ?? new Error('dial_failed');
}

async function runProxyWorker(cfg) {
  const dial = cfg.dialModule ? (await import(cfg.dialModule)).createDialer(cfg.dialState) : connect;
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
      const head = buf.subarray(idx + 4);
      try {
        const upstream = await dialBounded(target.host, target.port, client, cfg, dial);
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
function spawnProxyWorker(key, extra = {}) {
  const state = new Int32Array(new SharedArrayBuffer(16));
  const worker = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: { t3KubectlProxy: true, state, dialTimeoutMs: KUBECTL_DIAL_TIMEOUT_MS,
      maxAttempts: KUBECTL_DIAL_MAX_ATTEMPTS, ...extra },
  });
  worker.unref();
  Atomics.wait(state, 0, 0, 5_000);
  if (Atomics.load(state, 0) !== 1) throw new Error('kubectl_proxy_start_failed');
  const entry = { key, url: `http://127.0.0.1:${Atomics.load(state, 1)}`, state, worker };
  workers.set(key, entry);
  return entry;
}

function ensureProxyWorker(kubeconfig = '') {
  const key = kubeconfig || 'default';
  return (workers.get(key) ?? spawnProxyWorker(key)).url;
}

export function registerKubectlProxy({ kubeconfig = '', dialModule = null, dialState = null,
  dialTimeoutMs = KUBECTL_DIAL_TIMEOUT_MS, maxAttempts = KUBECTL_DIAL_MAX_ATTEMPTS } = {}) {
  const key = kubeconfig || 'default', prev = workers.get(key);
  if (prev) { workers.delete(key); prev.worker.terminate(); }
  const entry = spawnProxyWorker(key, { dialModule, dialState, dialTimeoutMs, maxAttempts });
  return { url: entry.url, close: async () => { if (workers.get(key) === entry) workers.delete(key); await entry.worker.terminate(); } };
}

export async function resetKubectlProxyForTests() {
  const list = [...workers.values()]; workers.clear();
  await Promise.all(list.map(e => e.worker.terminate()));
}

export function stripOwnedProxyEnv(env = process.env) {
  const next = { ...env };
  const owned = next.T3_KUBECTL_PROXY_URL;
  delete next.T3_KUBECTL_PROXY_URL;
  if (owned && next.HTTPS_PROXY === owned) delete next.HTTPS_PROXY;
  if (owned && next.https_proxy === owned) delete next.https_proxy;
  return next;
}

export function kubectlProxyEnv(env = process.env, opts = {}) {
  if (env.T3_KUBECTL_PROXY_DISABLE === '1') return stripOwnedProxyEnv(env);
  if (env.HTTPS_PROXY && env.HTTPS_PROXY !== env.T3_KUBECTL_PROXY_URL) return env;
  if (env.https_proxy && env.https_proxy !== env.T3_KUBECTL_PROXY_URL) return env;
  const url = env.T3_KUBECTL_PROXY_URL || ensureProxyWorker(opts.kubeconfig);
  return { ...env, T3_KUBECTL_PROXY_URL: url, HTTPS_PROXY: url, https_proxy: url };
}
