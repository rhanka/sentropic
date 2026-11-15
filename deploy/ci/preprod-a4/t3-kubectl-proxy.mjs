import { readFileSync } from 'node:fs';
import { BlockList, connect, createServer, isIP } from 'node:net';
import { isMainThread, Worker, workerData } from 'node:worker_threads';

export const KUBECTL_DIAL_TIMEOUT_MS = 2_000;
export const KUBECTL_DIAL_MAX_ATTEMPTS = 3;
const RETRYABLE_DIAL_CODES = new Set([
  'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EAI_AGAIN',
]);

export function parseKubeconfigInfo(kubeconfigPath) {
  const empty = { allowedTarget: '', hasHttpsServer: false, proxyUrl: '', host: '', port: 0 };
  if (!kubeconfigPath) return empty;
  let text = '', server = '', proxyUrl = '';
  try { text = readFileSync(kubeconfigPath, 'utf8'); } catch { return empty; }
  if (text.trimStart().startsWith('{')) {
    try {
      const cfg = JSON.parse(text), ctxName = cfg['current-context'];
      const ctx = (cfg.contexts ?? []).find(c => c.name === ctxName)?.context ?? cfg.contexts?.[0]?.context;
      const cl = (cfg.clusters ?? []).find(c => c.name === ctx?.cluster)?.cluster ?? cfg.clusters?.[0]?.cluster;
      server = String(cl?.server ?? ''); proxyUrl = String(cl?.['proxy-url'] ?? '');
    } catch { return empty; }
  } else {
    const clusters = [], contexts = [], unquote = v => v.trim().replace(/^['"]|['"]$/g, '');
    let section = '', cur = null, curIndent = -1, currentContext = '';
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/(?:^|\s)#.*$/, ''), trimmed = line.trim();
      if (!trimmed) continue;
      const indent = line.match(/^ */)[0].length;
      if (indent === 0 && !trimmed.startsWith('-')) {
        cur = null; curIndent = -1;
        const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(trimmed);
        section = m ? m[1] : '';
        if (section === 'current-context' && m[2]) currentContext = unquote(m[2]);
      } else if (section === 'clusters' || section === 'contexts') {
        if (trimmed.startsWith('-') && (curIndent === -1 || indent === curIndent)) {
          curIndent = indent; cur = {}; (section === 'clusters' ? clusters : contexts).push(cur);
        }
        const kv = /^([A-Za-z0-9_-]+):\s*(.+)$/.exec(trimmed.startsWith('-') ? trimmed.slice(1).trim() : trimmed);
        if (kv && cur) cur[kv[1]] = unquote(kv[2]);
      }
    }
    const clusterName = (contexts.find(c => c.name === currentContext) ?? contexts[0])?.cluster;
    const active = clusters.find(c => c.name === clusterName) ?? clusters[0];
    server = active?.server ?? ''; proxyUrl = active?.['proxy-url'] ?? '';
  }
  if (!URL.canParse(server)) return empty;
  const u = new URL(server);
  if (u.protocol !== 'https:') return empty;
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase(), port = u.port ? Number(u.port) : 443;
  return { allowedTarget: `${host}:${port}`, hasHttpsServer: true, proxyUrl, host, port };
}

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
  const markDead = () => { Atomics.store(cfg.state, 0, -1); Atomics.notify(cfg.state, 0); };
  process.on('exit', markDead);
  process.on('uncaughtException', err => { markDead(); throw err; });
  let server;
  const dial = cfg.dialModule
    ? (await import(cfg.dialModule)).createDialer(cfg.dialState, { emit: (...a) => server.emit(...a) })
    : connect;
  server = createServer(client => {
    client.setNoDelay(true);
    let buf = Buffer.alloc(0), connected = false;
    const hdrTimer = setTimeout(() => { if (!connected) client.destroy(); }, 5_000);
    const onData = async chunk => {
      buf = Buffer.concat([buf, chunk]);
      const idx = buf.indexOf('\r\n\r\n');
      if (idx === -1) { if (buf.length > 16_384) client.destroy(); return; }
      client.pause();
      client.removeListener('data', onData);
      clearTimeout(hdrTimer);
      const firstLine = buf.subarray(0, buf.indexOf('\r\n')).toString('latin1');
      const m = /^CONNECT ([^\s]+) HTTP\/1\.[01]$/.exec(firstLine);
      const target = m ? parseAuthority(m[1]) : null;
      if (!target) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
      if (!cfg.allowedTarget || `${target.host.toLowerCase()}:${target.port}` !== cfg.allowedTarget) {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
        return;
      }
      const head = buf.subarray(idx + 4);
      try {
        const upstream = await dialBounded(target.host, target.port, client, cfg, dial);
        if (client.destroyed) { upstream.destroy(); return; }
        connected = true;
        Atomics.add(cfg.state, 2, 1);
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
  server.on('error', () => {
    Atomics.store(cfg.state, 0, -1); Atomics.notify(cfg.state, 0);
    try { server.close(); } catch { /* closing */ }
  });
  server.listen(0, '127.0.0.1', () => {
    Atomics.store(cfg.state, 1, server.address().port);
    Atomics.store(cfg.state, 0, 1);
    Atomics.notify(cfg.state, 0);
  });
}

if (!isMainThread && workerData?.t3KubectlProxy) runProxyWorker(workerData);

const workers = new Map(), downKeys = new Set(), closedConnects = new Map(), ownedUrls = new Set();
let fallbackDirectDepth = 0;
export const enterProxyDirectFallback = () => { fallbackDirectDepth += 1; };
export const exitProxyDirectFallback = () => { fallbackDirectDepth = Math.max(0, fallbackDirectDepth - 1); };
export const isProxyDirectFallback = () => fallbackDirectDepth > 0;

function retireEntry(key, entry, markDown) {
  if (!entry) return;
  if (markDown) downKeys.add(key);
  if (entry.closing) return;
  closedConnects.set(key, (closedConnects.get(key) ?? 0) + Atomics.load(entry.state, 2));
  if (workers.get(key) === entry) workers.delete(key);
  entry.closing = true;
  return entry.worker.terminate();
}

function spawnProxyWorker(key, extra = {}) {
  const state = new Int32Array(new SharedArrayBuffer(16));
  const worker = new Worker(new URL(import.meta.url), {
    execArgv: [],
    workerData: { t3KubectlProxy: true, state, dialTimeoutMs: KUBECTL_DIAL_TIMEOUT_MS,
      maxAttempts: KUBECTL_DIAL_MAX_ATTEMPTS, ...extra },
  });
  const entry = { key, url: '', state, worker, closing: false };
  const onDown = () => { if (!entry.closing) { Atomics.store(state, 0, -1); Atomics.notify(state, 0); retireEntry(key, entry, true); } };
  worker.on('error', onDown); worker.on('exit', onDown); worker.unref();
  Atomics.wait(state, 0, 0, 5_000);
  if (Atomics.load(state, 0) !== 1) { retireEntry(key, entry, true); throw new Error('kubectl_proxy_down'); }
  entry.url = `http://127.0.0.1:${Atomics.load(state, 1)}`;
  ownedUrls.add(entry.url);
  workers.set(key, entry);
  return entry;
}

function workerKey(kubeconfig) {
  const { allowedTarget } = parseKubeconfigInfo(kubeconfig);
  return { key: allowedTarget || kubeconfig || 'default', allowedTarget };
}
export function isKubectlProxyDown(kubeconfig = '') {
  const { key } = workerKey(kubeconfig), entry = workers.get(key);
  if (entry && Atomics.load(entry.state, 0) !== 1) retireEntry(key, entry, true);
  return downKeys.has(key);
}
export function markKubectlProxyDown(kubeconfig = '') {
  const { key } = workerKey(kubeconfig); downKeys.add(key); retireEntry(key, workers.get(key), true);
}
export function kubectlProxyConnectCount(kubeconfig = '') {
  const { key } = workerKey(kubeconfig), entry = workers.get(key);
  return (closedConnects.get(key) ?? 0) + (entry ? Atomics.load(entry.state, 2) : 0);
}
function ensureProxyWorker(kubeconfig = '') {
  if (isKubectlProxyDown(kubeconfig)) throw new Error('kubectl_proxy_down');
  const { key, allowedTarget } = workerKey(kubeconfig);
  return { ...(workers.get(key) ?? spawnProxyWorker(key, { allowedTarget })), allowedTarget };
}

export function registerKubectlProxy({ kubeconfig = '', dialModule = null, dialState = null,
  dialTimeoutMs = KUBECTL_DIAL_TIMEOUT_MS, maxAttempts = KUBECTL_DIAL_MAX_ATTEMPTS } = {}) {
  const { key, allowedTarget } = workerKey(kubeconfig);
  downKeys.delete(key);
  retireEntry(key, workers.get(key), false);
  const entry = spawnProxyWorker(key, { allowedTarget, dialModule, dialState, dialTimeoutMs, maxAttempts });
  return { url: entry.url, close: async () => { await retireEntry(key, entry, false); } };
}

export async function resetKubectlProxyForTests() {
  const list = [...workers.entries()];
  workers.clear(); downKeys.clear(); closedConnects.clear(); ownedUrls.clear(); fallbackDirectDepth = 0;
  await Promise.all(list.map(([, e]) => { e.closing = true; return e.worker.terminate(); }));
}

export function stripOwnedProxyEnv(env = process.env) {
  const next = { ...env };
  const owned = next.T3_KUBECTL_PROXY_URL;
  delete next.T3_KUBECTL_PROXY_URL;
  delete next.T3_KUBECTL_PROXY_TARGET;
  if (owned && next.HTTPS_PROXY === owned) delete next.HTTPS_PROXY;
  if (owned && next.https_proxy === owned) delete next.https_proxy;
  return next;
}

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isProxyConnectRefused(stderr, proxyUrl, allowedTarget = '') {
  if (!stderr || !proxyUrl || !URL.canParse(proxyUrl)) return false;
  const u = new URL(proxyUrl);
  if (u.hostname !== '127.0.0.1' || !/^\d+$/.test(u.port)) return false;
  if (new RegExp(`proxyconnect tcp: dial tcp 127\\.0\\.0\\.1:${u.port}:\\s*(?:connect:\\s*)?(?:connection refused|ECONNREFUSED)`, 'i').test(stderr)) {
    return true;
  }
  if (!allowedTarget || /^(?:127\.|localhost:|::1:|\[::1\]:)/i.test(allowedTarget)) return false;
  return new RegExp(`^The connection to the server ${escapeRe(allowedTarget)} was refused - did you specify the right host or port\\?\\s*$`, 'm').test(stderr);
}

export function handleProxyCallFailure({ kEnv, kubeconfig = '', before = 0, result, fallback = false }) {
  const url = kEnv?.T3_KUBECTL_PROXY_URL;
  if (!url || (!result?.error && result?.status === 0)) return false;
  const target = kEnv?.T3_KUBECTL_PROXY_TARGET || (kubeconfig ? parseKubeconfigInfo(kubeconfig).allowedTarget : '');
  const refused = isProxyConnectRefused(result.stderr ?? '', url, target);
  if (!ownedUrls.has(url)) {
    if (!isKubectlProxyDown(kubeconfig) && !refused) return false;
    markKubectlProxyDown(kubeconfig);
    throw new Error('kubectl_proxy_down');
  }
  if (!isKubectlProxyDown(kubeconfig) && !refused) return false;
  markKubectlProxyDown(kubeconfig);
  if (kubectlProxyConnectCount(kubeconfig) !== before) return false;
  if (!fallback) throw new Error('kubectl_proxy_down');
  return true;
}

export function inspectDialProxyBypass(env = process.env, kubeconfig = '') {
  if (env.T3_KUBECTL_PROXY_DISABLE === '1') return 'disabled';
  if ((env.HTTPS_PROXY && env.HTTPS_PROXY !== env.T3_KUBECTL_PROXY_URL)
    || (env.https_proxy && env.https_proxy !== env.T3_KUBECTL_PROXY_URL)) return 'https_proxy';
  const info = parseKubeconfigInfo(kubeconfig);
  if (info.proxyUrl) return 'kubeconfig_proxy_url';
  const rawNo = env.NO_PROXY || env.no_proxy || '';
  if (rawNo && info.hasHttpsServer) {
    for (const part of rawNo.split(',').map(s => s.trim()).filter(Boolean)) {
      if (part === '*') return 'no_proxy';
      if (part.includes('/') && isIP(info.host)) {
        const [netAddr, pfx] = part.split('/'), fam = isIP(info.host), n = Number(pfx);
        if (fam === isIP(netAddr) && Number.isInteger(n)) {
          const bl = new BlockList(); bl.addSubnet(netAddr, n, fam === 6 ? 'ipv6' : 'ipv4');
          if (bl.check(info.host, fam === 6 ? 'ipv6' : 'ipv4')) return 'no_proxy';
        }
        continue;
      }
      const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(part);
      if (!m || (m[2] && Number(m[2]) !== info.port)) continue;
      const h = m[1].replace(/^\[|\]$/g, '').toLowerCase();
      if (h.startsWith('*.') ? info.host.endsWith(h.slice(1))
        : h.startsWith('.') ? info.host.endsWith(h)
          : info.host === h || info.host.endsWith(`.${h}`)) return 'no_proxy';
    }
  }
  return null;
}

export function kubectlProxyEnv(env = process.env, opts = {}) {
  const fallback = Boolean(opts.fallbackDirect || isProxyDirectFallback());
  if (env.T3_KUBECTL_PROXY_DISABLE === '1') return stripOwnedProxyEnv(env);
  if (env.HTTPS_PROXY && env.HTTPS_PROXY !== env.T3_KUBECTL_PROXY_URL) return env;
  if (env.https_proxy && env.https_proxy !== env.T3_KUBECTL_PROXY_URL) return env;
  const reqTarget = opts.kubeconfig ? parseKubeconfigInfo(opts.kubeconfig).allowedTarget : '';
  const reuse = Boolean(env.T3_KUBECTL_PROXY_URL && !ownedUrls.has(env.T3_KUBECTL_PROXY_URL)
    && workers.size === 0 && (!reqTarget || env.T3_KUBECTL_PROXY_TARGET === reqTarget));
  try {
    if (isKubectlProxyDown(opts.kubeconfig)) throw new Error('kubectl_proxy_down');
    const { url, allowedTarget } = reuse
      ? { url: env.T3_KUBECTL_PROXY_URL, allowedTarget: env.T3_KUBECTL_PROXY_TARGET ?? '' }
      : ensureProxyWorker(opts.kubeconfig);
    return { ...env, T3_KUBECTL_PROXY_URL: url, T3_KUBECTL_PROXY_TARGET: allowedTarget, HTTPS_PROXY: url, https_proxy: url };
  } catch (err) {
    if (fallback && !reuse && err?.message === 'kubectl_proxy_down') return stripOwnedProxyEnv(env);
    throw err;
  }
}
