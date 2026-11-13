import assert from 'node:assert/strict';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createPrivateKey, sign } from 'node:crypto';
import { qualificationCertificates } from './qualification-certificates.js';
import type { qualificationNode } from './data-plane-qualification-node.js';

export async function probeDataPlane(options: {
  socketPath: string; certificates: ReturnType<typeof qualificationCertificates>;
  node: Pick<ReturnType<typeof qualificationNode>, 'keys' | 'ownership' | 'revoke'>; uid: string;
  report(name: string): void; checkTcp(): void;
}) {
  const { certificates: tls, uid, node, report } = options;
  const signingKey = createPrivateKey(node.keys.privateKeyPem);
  const token = (ttl = 10000, overrides = {}) => {
    const now = Date.now();
    const head = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ tenantId: 'sentropic', principalId: 'qualification', resourceId: uid,
      custodyEpoch: node.ownership.custodyEpoch, issuedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + ttl).toISOString(), ...overrides })).toString('base64url');
    const input = `${head}.${payload}`;
    return `${input}.${sign(null, Buffer.from(input), signingKey).toString('base64url')}`;
  };
  const open = (signed: string, headers = {}, path = '/v1/ports/5173/', identity: Pick<RequestOptions, 'cert' | 'key'> = tls.dataPlane) => {
    const req = request({ socketPath: options.socketPath, servername: 'localhost', ca: tls.ca, ...identity,
      path, agent: false, headers: { 'x-tenant-id': 'sentropic', 'x-expected-physical-uid': uid, 'x-custody-token': signed, ...headers } });
    req.setTimeout(1000, () => req.destroy(new Error('qualification request timeout')));
    req.on('error', () => {}); return req;
  };
  const http = (signed: string) => new Promise<IncomingMessage>((resolve, reject) => {
    const req = open(signed); req.once('error', reject); req.once('response', res => {
      req.setTimeout(0); res.once('error', () => {});
      res.once('data', data => {
        try { assert.equal(res.statusCode, 200); assert.equal(data.toString(), 'qualification-stream'); resolve(res); }
        catch (error) { res.destroy(); reject(error); }
      });
    }); req.end();
  });
  const ws = (signed: string) => new Promise<Duplex>((resolve, reject) => {
    const req = open(signed, { connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-version': '13', 'sec-websocket-key': Buffer.alloc(16, 7).toString('base64') });
    req.once('error', reject); req.once('response', res => { res.destroy(); reject(new Error('HMR upgrade refused')); });
    req.once('upgrade', (res, socket) => { req.setTimeout(0); assert.equal(res.statusCode, 101); resolve(socket); }); req.end();
  });
  // The process being running does not imply its application has called listen yet.
  const deadline = Date.now() + 5000;
  for (;;) {
    try { const res = await http(token()); res.destroy(); break; }
    catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  report('mTLS HTTP through real runsc UDS to 5173'); options.checkTcp();
  for (const identity of [{}, qualificationCertificates().dataPlane]) {
    await assert.rejects(new Promise<void>((resolve, reject) => {
      const req = open(token(), {}, '/v1/ports/5173/', identity);
      req.once('error', reject); req.once('response', res => { res.destroy(); resolve(); }); req.end();
    }));
  }
  report('mTLS refuses absent and untrusted client certificates');
  for (const [name, headers, path, identity, signed] of [
    ['wrong CN', {}, '/v1/ports/5173/', tls.wrong, token()],
    ['control-plane CN', {}, '/v1/ports/5173/', tls.controlPlane, token()],
    ['cross tenant', { 'x-tenant-id': 'immo' }, '/v1/ports/5173/', tls.dataPlane, token()],
    ['wrong UID', { 'x-expected-physical-uid': 'other' }, '/v1/ports/5173/', tls.dataPlane, token()],
    ['wrong port', {}, '/v1/ports/22/', tls.dataPlane, token()],
    ['wrong epoch', {}, '/v1/ports/5173/', tls.dataPlane, token(10000, { custodyEpoch: 9 })],
    ['wrong principal', {}, '/v1/ports/5173/', tls.dataPlane, token(10000, { principalId: 'other' })],
    ['execution ticket', { 'x-execution-ticket': 'forbidden' }, '/v1/ports/5173/', tls.dataPlane, token()],
  ] as const) {
    const req = open(signed, headers, path, identity);
    const status = await new Promise<number>((resolve, reject) => {
      req.once('error', reject); req.once('response', res => { res.resume(); resolve(res.statusCode!); }); req.end();
    });
    assert.equal(status, 403, name); report(`refuse ${name}`);
    const upgrade = open(signed, { ...headers, connection: 'Upgrade', upgrade: 'websocket' }, path, identity);
    const wsStatus = await new Promise<number>((resolve, reject) => {
      upgrade.once('error', reject); upgrade.once('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
      upgrade.once('response', res => { res.resume(); resolve(res.statusCode!); }); upgrade.end();
    });
    assert.equal(wsStatus, 403, `${name} WS`);
  }
  for (const mode of ['expiry', 'revoke-custody'] as const) {
    const ttl = mode === 'expiry' ? 1500 : 10000;
    const issuedAt = Date.now(), signed = token(ttl);
    const [res, socket] = await Promise.all([http(signed), ws(signed)]);
    options.checkTcp();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = Promise.all([
      new Promise<number>(resolve => res.once('aborted', () => resolve(Date.now()))),
      new Promise<number>((resolve, reject) => {
        socket.once('error', reject);
        socket.once('data', frame => {
          try { assert.deepEqual(frame.subarray(0, 4), Buffer.from([0x88, 2, 3, 0xf0])); resolve(Date.now()); }
          catch (error) { reject(error); }
        });
      }),
    ]);
    const start = mode === 'expiry' ? issuedAt + ttl : Date.now();
    try {
      const bounded = Promise.race([cut, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${mode} stream cut timeout`)), Math.max(0, start - Date.now()) + 1000);
      })]);
      if (mode === 'revoke-custody') await node.revoke();
      const ended = await bounded;
      for (const at of ended) assert.ok(at - start <= 250, `${mode} must cut locally within 250 ms`);
      report(`${mode} concurrent HTTP + WS 1008 within 250 ms (and <=1s end-to-end)`);
    } finally { clearTimeout(timer); res.destroy(); socket.destroy(); }
  }
}
