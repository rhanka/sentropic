import { spawn } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { connect, type AddressInfo, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { AGENT_SOURCE } from '../../../src/services/artifacts/live/bootstrap-agent';
import { SERVER_SOURCE, SUPERVISOR_PATH } from '../../../src/services/artifacts/live/bootstrap-server';
import { MAX_BOOTSTRAP_BYTES, bootstrapConfig, createBootstrapSource } from '../../../src/services/artifacts/live/bootstrap';
import { artifactEnvironment, buildEnvironment } from '../../../src/services/artifacts/live/recipes';
import { harness, seal } from './bootstrap-harness';

let loaded: Promise<any> | undefined;
const serverModule = () => loaded ??= import(/* @vite-ignore */
  `data:text/javascript;base64,${Buffer.from(AGENT_SOURCE + SERVER_SOURCE).toString('base64')}`);
const open: (Server | Socket)[] = [];
afterEach(() => { for (const item of open.splice(0)) { if ('destroy' in item) item.destroy(); else item.close(); } });
const listen = async (server: Server) => {
  open.push(server); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
};
const call = (port: number, method: string, path: string, headers: Record<string, string> = {}, body?: Buffer) =>
  new Promise<{ status: number; text: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, res => {
      const chunks: Buffer[] = []; res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
const upgrade = (port: number, path: string) => new Promise<{ socket: Socket; head: string }>((resolve, reject) => {
  const socket = connect(port, '127.0.0.1', () => socket.write(`GET ${path} HTTP/1.1\r\nHost: pod\r\nUpgrade: websocket\r\n`
    + 'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: sid=secret\r\n\r\n'));
  open.push(socket); let head = '';
  socket.on('data', chunk => { head += chunk.toString(); if (head.includes('\r\n\r\n')) resolve({ socket, head }); });
  socket.on('close', () => resolve({ socket, head })); socket.on('error', reject);
});

describe('pod bootstrap :5173 listener', () => {
  it('should carry signed supervisor frames on one POST path and refuse everything else outside the live phase', async () => {
    const pod = await harness(); const { createControlServer } = await serverModule();
    const port = await listen(createControlServer(pod.agent, 1).server);
    const frame = pod.body('phase', { phase: 'stopped' });
    const ok = await call(port, 'POST', SUPERVISOR_PATH, {}, seal(pod.keys.privateKey, frame));
    expect(ok.status).toBe(200); expect(JSON.parse(ok.text)).toMatchObject({ id: frame.id, ok: true, data: { phase: 'stopped' } });
    const other = generateKeyPairSync('ed25519');
    expect(await call(port, 'POST', SUPERVISOR_PATH, {}, seal(other.privateKey, pod.body('phase', { phase: 'stopped' }))))
      .toEqual({ status: 403, text: '' });
    expect((await call(port, 'GET', SUPERVISOR_PATH)).status).toBe(404);
    expect((await call(port, 'GET', '/index.html')).status).toBe(404);
    const oversized = await call(port, 'POST', SUPERVISOR_PATH, {}, Buffer.alloc(2 * 1024 * 1024 + 1)).catch(() => ({ status: 413 }));
    expect(oversized.status).toBe(413);
    expect((await upgrade(port, '/_live/s1/hmr')).head).toBe('');
  });

  it('should forward only GET/HEAD and the HMR upgrade to loopback Vite in the live phase, without credentials', async () => {
    const { createControlServer } = await serverModule();
    const seen: IncomingHttpHeaders[] = [];
    const vite = createServer((req, res) => { seen.push(req.headers); res.end(`vite:${req.url}`); });
    vite.on('upgrade', (req, socket) => {
      seen.push(req.headers);
      socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
      socket.on('data', data => socket.write(data));
    });
    const upstream = await listen(vite);
    let live = true;
    const control = createControlServer({ receive: async () => null, isLive: () => live }, upstream);
    const port = await listen(control.server);
    const got = await call(port, 'GET', '/src/main.ts?t=1', { accept: 'text/javascript', cookie: 'sid=secret', authorization: 'Bearer x' });
    expect(got).toEqual({ status: 200, text: 'vite:/src/main.ts?t=1' });
    expect(seen[0]).toMatchObject({ accept: 'text/javascript' });
    expect(seen[0]).not.toHaveProperty('cookie'); expect(seen[0]).not.toHaveProperty('authorization');
    expect((await call(port, 'POST', '/src/main.ts')).status).toBe(404);
    expect((await call(port, 'POST', SUPERVISOR_PATH, {}, Buffer.from('x'))).status).toBe(403);
    const ws = await upgrade(port, '/_live/s1/hmr?token=abc');
    expect(ws.head).toContain('101 Switching Protocols');
    expect(seen[1]).toMatchObject({ upgrade: 'websocket', 'sec-websocket-version': '13' });
    expect(seen[1]).not.toHaveProperty('cookie');
    const echoed = new Promise<string>(resolve => ws.socket.once('data', data => resolve(data.toString())));
    ws.socket.write('ping'); expect(await echoed).toBe('ping');
    const closed = new Promise<void>(resolve => ws.socket.once('close', () => resolve()));
    live = false; control.closeLive(); await closed;
    expect((await call(port, 'GET', '/src/main.ts')).status).toBe(404);
  });
});

describe('pod bootstrap program', () => {
  const spki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

  it('should embed only the public key, frozen recipes and the host env, within one argv string', async () => {
    const source = createBootstrapSource(spki);
    expect(source.startsWith(AGENT_SOURCE + SERVER_SOURCE)).toBe(true);
    expect(source.endsWith(`\nawait startBootstrap(${JSON.stringify(bootstrapConfig(spki))});\n`)).toBe(true);
    expect(Buffer.byteLength(source)).toBeLessThan(MAX_BOOTSTRAP_BYTES);
    const config = bootstrapConfig(spki);
    expect(config).toMatchObject({ PUBLIC_KEY: spki, CONTROL_PORT: 5173, UPSTREAM_PORT: 5174, ENV: artifactEnvironment() });
    expect(config.ENV.NODE_OPTIONS).toBe('--max-old-space-size=384');
    expect(config.BUILD_ENV).toEqual(buildEnvironment()); expect(config.BUILD_ENV.NODE_OPTIONS).toBe('--max-old-space-size=1024');
    for (const banned of ['activeDeadlineSeconds', 'createHmac', 'PRIVATE KEY', '/run/', "shell: true", 'execSync']) {
      expect(source).not.toContain(banned);
    }
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    for (const key of ['', 'x', rsa, spki.slice(1)]) expect(() => createBootstrapSource(key)).toThrow('builder_unavailable');
  });

  it('should run as a real `node --input-type=module -e` program and answer a signed frame bound to its pod', async () => {
    const keys = generateKeyPairSync('ed25519');
    const key = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    const probe = createServer(); const port = await listen(probe); probe.close(); open.pop();
    const program = createBootstrapSource(key).replace(/\nawait startBootstrap\(.*\);\n$/,
      `\nawait startBootstrap(${JSON.stringify({ ...bootstrapConfig(key), CONTROL_PORT: port })});\n`);
    const child = spawn(process.execPath, ['--input-type=module', '-e', program],
      { env: { PATH: process.env.PATH ?? '', ARTIFACT_POD_UID: 'uid-1' }, stdio: 'ignore' });
    try {
      const fence = { generation: 1, sessionId: 's1', leaseEpoch: 1, routeEpoch: 1, podName: hostname(), podUid: 'uid-1' };
      const now = Date.now(); const body = { v: 1, id: 'e2e-1', op: 'phase', fence, issuedAt: now, expiresAt: now + 30_000,
        args: { phase: 'stopped' } };
      let reply: { status: number; text: string } | undefined;
      for (let i = 0; i < 100 && !reply; i++) {
        reply = await call(port, 'POST', SUPERVISOR_PATH, {}, seal(keys.privateKey, body)).catch(() => undefined);
        if (!reply) await new Promise(resolve => setTimeout(resolve, 50));
      }
      expect(reply?.status).toBe(200);
      expect(JSON.parse(reply!.text)).toMatchObject({ id: 'e2e-1', ok: true, data: { phase: 'stopped', egress: 'static-deny' } });
      const wrong = { ...body, id: 'e2e-2', fence: { ...fence, podUid: 'uid-2' } };
      expect(JSON.parse((await call(port, 'POST', SUPERVISOR_PATH, {}, seal(keys.privateKey, wrong))).text))
        .toMatchObject({ id: 'e2e-2', ok: false, code: 'fenced' });
      expect((await call(port, 'GET', '/')).status).toBe(404);
    } finally { child.kill('SIGKILL'); }
  });

  it('should fail closed without a valid Ed25519 key or the downward-API pod UID, before listening', async () => {
    const { startBootstrap } = await serverModule();
    const exits: number[] = []; const exit = (code: number) => { exits.push(code); };
    expect(await startBootstrap({ ...bootstrapConfig(spki), PUBLIC_KEY: 'x' }, { env: { ARTIFACT_POD_UID: 'u-1' }, exit })).toBeUndefined();
    expect(await startBootstrap(bootstrapConfig(spki), { env: {}, exit })).toBeUndefined();
    expect(await startBootstrap(bootstrapConfig(spki), { env: { ARTIFACT_POD_UID: 'bad uid' }, exit })).toBeUndefined();
    expect(exits).toEqual([1, 1, 1]);
  });
});
