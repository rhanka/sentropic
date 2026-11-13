import assert from 'node:assert/strict';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { createPrivateKey, sign } from 'node:crypto';
import { qualificationCertificates } from './qualification-certificates.js';
import type { qualificationNode } from './data-plane-qualification-node.js';
import type { RuntimeDiagnostic } from './qualification-diagnostics.js';
import { forwardBudget } from './forward-budget.js';

export async function probeDataPlane(options: {
  socketPath: string; certificates: ReturnType<typeof qualificationCertificates>;
  node: Pick<ReturnType<typeof qualificationNode>, 'keys' | 'ownership' | 'revoke'>; uid: string;
  report(name: string): void; checkTcp(): void;
  signal?: AbortSignal;
  diagnostic?: RuntimeDiagnostic; stage?(name: string): void;
  switchMode?: 'switch-closed' | 'digest-mismatch'; closeSwitch?(): void;
  verifyBurst?(): void;
}) {
  const { certificates: tls, uid, node, report } = options;
  let probe = 0;
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
    const name = `probe ${++probe}`;
    options.diagnostic?.(name, 'TLS -> custody -> UDS -> port-forward -> 5173');
    const req = request({ socketPath: options.socketPath, servername: 'localhost', ca: tls.ca, ...identity,
      signal: options.signal,
      path, agent: false, headers: { 'x-tenant-id': 'sentropic', 'x-expected-physical-uid': uid, 'x-custody-token': signed, ...headers } });
    req.once('response', res => {
      options.diagnostic?.(name, `HTTP status=${res.statusCode}`);
      res.once('data', () => options.diagnostic?.(name, 'HTTP first byte'));
    });
    req.once('upgrade', res => options.diagnostic?.(name, `WS upgrade=${res.statusCode}`));
    req.once('error', () => options.diagnostic?.(name, 'FAIL request before completion (TLS/UDS/5173)'));
    req.setTimeout(1000, () => req.destroy(new Error('qualification request timeout')));
    const timer = setTimeout(() => req.destroy(new Error('qualification probe deadline exceeded')), 1000);
    const clear = () => clearTimeout(timer);
    req.once('error', clear); req.once('close', clear);
    req.once('response', res => {
      for (const event of ['data', 'end', 'error', 'aborted', 'close']) res.once(event, clear);
    });
    req.once('upgrade', (_res, socket) => {
      clear();
      const abort = () => socket.destroy();
      options.signal?.addEventListener('abort', abort, { once: true });
      socket.once('close', () => options.signal?.removeEventListener('abort', abort));
    });
    req.on('error', () => {}); return req;
  };
  const http = (signed: string) => new Promise<IncomingMessage>((resolve, reject) => {
    const req = open(signed); req.once('error', reject); req.once('response', res => {
      req.setTimeout(0);
      let received = false;
      const ended = () => { if (!received) reject(new Error('qualification response ended before first bytes')); };
      res.once('error', reject); res.once('end', ended); res.once('aborted', ended); res.once('close', ended);
      res.once('data', data => {
        received = true;
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
  options.stage?.('HTTP first byte from 5173');
  for (;;) {
    options.signal?.throwIfAborted();
    try { const res = await http(token()); res.destroy(); break; }
    catch (error) { if (Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 25)); }
  }
  report('mTLS HTTP through real runsc UDS to 5173'); options.checkTcp();
  if (!options.switchMode) {
  const held: IncomingMessage[] = [];
  try {
    for (let i = 0; i < forwardBudget.limit; i++) held.push(await http(token()));
    const responses = await Promise.all(Array.from({ length: 12 }, () => new Promise<number>((resolve, reject) => {
      const req = open(token()); req.once('error', reject);
      req.once('response', res => { res.resume(); resolve(res.statusCode!); }); req.end();
    })));
    assert.ok(responses.every(status => status === 429), 'burst must refuse saturated forwarding');
    const upgrade = open(token(), { connection: 'Upgrade', upgrade: 'websocket' });
    const wsStatus = await new Promise<number>((resolve, reject) => {
      upgrade.once('error', reject); upgrade.once('upgrade', (_res, socket) => { socket.destroy(); resolve(101); });
      upgrade.once('response', res => { res.resume(); resolve(res.statusCode!); }); upgrade.end();
    });
    assert.equal(wsStatus, 429, 'saturated WebSocket handshake must preserve typed refusal');
    assert.equal(forwardBudget.inUse, forwardBudget.limit);
    options.verifyBurst?.(); options.checkTcp();
    report('data-plane burst: capped helpers, bounded queue, 429 saturation under unit caps');
  } finally { for (const res of held) res.destroy(); }
  const burstDeadline = Date.now() + 1000;
  while (forwardBudget.inUse) {
    assert.ok(Date.now() < burstDeadline, 'burst forwarding slots did not drain');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  options.stage?.('mTLS certificate refusals');
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
    options.stage?.(`HTTP/WS refuse ${name}`);
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
  }
  for (const mode of options.switchMode ? [options.switchMode] : ['expiry', 'revoke-custody']) {
    options.stage?.(`HTTP/WS ${mode}`);
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
      if (mode === 'switch-closed' || mode === 'digest-mismatch') options.closeSwitch!();
      const ended = await bounded;
      for (const at of ended) assert.ok(at - start <= 250, `${mode} cut latency ${at - start}ms exceeds 250ms`);
      report(`${mode} concurrent HTTP + WS 1008 within 250 ms (and <=1s end-to-end)`);
    } finally { clearTimeout(timer); res.destroy(); socket.destroy(); }
  }
}
