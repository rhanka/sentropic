/**
 * Pod bootstrap :5173 listener and pod entry (W2 §2, A-LIVE §8.1). The worker's only ingress carries:
 * - `POST /_supervisor/v1/frame`: one W3 signed frame per request (≤ 2 MiB), answered 200 with its reply
 *   bytes, or 403 with an empty body when the frame is refused before any operation;
 * - in the live phase only: GET/HEAD and the HMR websocket upgrade, forwarded to Vite on 127.0.0.1:5174 with a
 *   header allowlist (no cookie or authorization reaches Vite); forwarded sockets close when live ends;
 * - nothing else: 404 and close.
 * The entry reads the Ed25519 SPKI public key embedded in the pod spec and the pod identity (hostname = pod
 * name, `ARTIFACT_POD_UID` from the downward API), and fails closed without them.
 */
export const SUPERVISOR_PATH = '/_supervisor/v1/frame';
export const SERVER_SOURCE = String.raw`
import { spawn as serverSpawn } from 'node:child_process';
import { createPublicKey as serverKey } from 'node:crypto';
import { readFile as serverRead, readdir as serverList } from 'node:fs/promises';
import { createServer as serverHttp, request as serverRequest } from 'node:http';
import { connect as serverConnect } from 'node:net';
import { hostname as serverHostname } from 'node:os';

const SERVER = { path: '${SUPERVISOR_PATH}', maxFrame: 2097152, upstream: '127.0.0.1',
  forward: ['host', 'accept', 'accept-encoding', 'if-none-match', 'if-modified-since'],
  upgrade: ['host', 'origin', 'upgrade', 'connection', 'sec-websocket-key', 'sec-websocket-version', 'sec-websocket-protocol',
    'sec-websocket-extensions'] };

export function createControlServer(agent, upstreamPort) {
  const live = new Set();
  const track = (socket) => { live.add(socket); socket.once('close', () => live.delete(socket)); return socket; };
  const pick = (headers, names) => Object.fromEntries(names.filter((n) => typeof headers[n] === 'string').map((n) => [n, headers[n]]));
  const refuse = (res, status = 404) => { res.writeHead(status, { connection: 'close', 'content-length': '0' }).end(); };
  const server = serverHttp({ maxHeaderSize: 16384, requestTimeout: 120000 }, (req, res) => {
    if (req.url === SERVER.path) {
      if (req.method !== 'POST') return refuse(res);
      const chunks = []; let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > SERVER.maxFrame) { refuse(res, 413); req.destroy(); } else chunks.push(chunk);
      });
      req.on('end', async () => {
        if (size > SERVER.maxFrame) return;
        const reply = await agent.receive(Buffer.concat(chunks)).catch(() => null);
        if (!reply) return refuse(res, 403);
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(reply.length) }).end(reply);
      });
      return;
    }
    if (!agent.isLive() || (req.method !== 'GET' && req.method !== 'HEAD')) return refuse(res);
    const upstream = serverRequest({ host: SERVER.upstream, port: upstreamPort, method: req.method, path: req.url,
      headers: pick(req.headers, SERVER.forward) }, (answer) => { res.writeHead(answer.statusCode || 502, answer.headers); answer.pipe(res); });
    upstream.on('socket', track);
    upstream.on('error', () => { if (!res.headersSent) refuse(res, 502); else res.destroy(); });
    res.on('close', () => upstream.destroy());
    upstream.end();
  });
  server.on('upgrade', (req, socket, head) => {
    if (!agent.isLive() || req.method !== 'GET' || req.url === SERVER.path || String(req.headers.upgrade).toLowerCase() !== 'websocket') {
      socket.destroy(); return;
    }
    const upstream = serverConnect(upstreamPort, SERVER.upstream, () => {
      const headers = pick(req.headers, SERVER.upgrade);
      upstream.write('GET ' + req.url + ' HTTP/1.1\r\n' + Object.entries(headers).map(([k, v]) => k + ': ' + v + '\r\n').join('') + '\r\n');
      if (head && head.length) upstream.write(head);
      upstream.pipe(socket); socket.pipe(upstream);
    });
    track(socket); track(upstream);
    const close = () => { socket.destroy(); upstream.destroy(); };
    for (const s of [socket, upstream]) { s.on('error', close); s.on('close', close); }
  });
  return { server, closeLive: () => { for (const s of [...live]) s.destroy(); } };
}

/** The pod's own processes (pid namespace of the container), excluding this bootstrap and dead zombies. */
export function podProcesses() {
  return {
    async list() {
      const pids = [];
      for (const name of await serverList('/proc')) {
        if (!/^[0-9]+$/.test(name) || Number(name) === process.pid) continue;
        const stat = await serverRead('/proc/' + name + '/stat', 'utf8').catch(() => '');
        const state = stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3);
        if (stat && state !== 'Z' && state !== 'X') pids.push(Number(name));
      }
      return pids;
    },
    kill(pid) { try { process.kill(pid, 'SIGKILL'); } catch {} },
    killGroup(pgid) { try { process.kill(-pgid, 'SIGKILL'); } catch {} },
  };
}
async function podSockets() {
  const lines = [];
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    const text = await serverRead(file, 'utf8').catch(() => '');
    lines.push(...text.split('\n').slice(1).filter(Boolean));
  }
  return lines;
}
function podWaitPort(port, timeoutMs, child) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs; let exited = false;
    child.once('exit', () => { exited = true; });
    const attempt = () => {
      if (exited || Date.now() > deadline) { reject(new Error('dev_unavailable')); return; }
      const socket = serverConnect(port, SERVER.upstream, () => { socket.destroy(); resolve(); });
      socket.on('error', () => { socket.destroy(); setTimeout(attempt, 100); });
    };
    attempt();
  });
}

export async function startBootstrap(frozen, host = { env: process.env, exit: (code) => process.exit(code) }) {
  let publicKey = null;
  try { publicKey = serverKey({ key: Buffer.from(String(frozen.PUBLIC_KEY), 'base64'), format: 'der', type: 'spki' }); } catch {}
  if (!publicKey || publicKey.asymmetricKeyType !== 'ed25519') { console.error('control_key_invalid'); return host.exit(1); }
  const podUid = host.env.ARTIFACT_POD_UID;
  if (typeof podUid !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(podUid)) { console.error('pod_identity_missing'); return host.exit(1); }
  let control = null;
  const agent = createAgent({ root: '/', recipes: frozen.RECIPES, env: frozen.ENV, publicKey, identity: { podName: serverHostname(), podUid },
    spawn: serverSpawn, processes: podProcesses(), sockets: podSockets, waitPort: podWaitPort, now: Date.now,
    controlPort: frozen.CONTROL_PORT, upstreamPort: frozen.UPSTREAM_PORT,
    exit: (code) => { console.error('liveness_lease_expired'); host.exit(code); }, liveEnded: () => control && control.closeLive() });
  control = createControlServer(agent, frozen.UPSTREAM_PORT);
  setInterval(() => { agent.checkLease(); }, 60000);
  process.on('SIGTERM', () => { agent.terminate().finally(() => host.exit(0)); });
  control.server.listen(frozen.CONTROL_PORT, '0.0.0.0');
  return control;
}
`;
