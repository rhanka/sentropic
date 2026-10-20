import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGatewayHost } from '../src/node/gateway-host.js';
import { createGatewayControlClient } from '../src/node/control-client.js';
import { durableHostFixture, model, routingContract } from './helpers/durable-host.js';
const session = { ownerScopeRef: 'owner-a', workspaceRef: 'w', clientSessionRef: 'c', routingContract };
const send = (endpoint: string, key: string) => fetch(`${endpoint}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'synthetic' }] }) });
describe('durable published host composition', () => {
  it('serves through the real planner, recovers its key/receipts and retains revocation', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-host-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    let host = await startGatewayHost(options);
    try {
      expect((await host.readiness()).ready).toBe(true);
      let control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const issued = await control.acquireSession(session);
      const response = await send(host.endpoint, issued.key!);
      const body = await response.text(); expect(response.status, body).toBe(200);
      const receiptId = response.headers.get('x-sentropic-receipt')!;
      expect(receiptId).toBeTruthy();
      expect((await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement).toBe('stop');
      expect(await readFile(join(stateDir, 'gateway-state.enc'), 'utf8')).not.toContain(issued.key!);
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture().mesh });
      control = createGatewayControlClient({ controlSocket: host.controlSocket });
      expect(await control.acquireSession(session)).toMatchObject({ key: issued.key, sessionRef: issued.sessionRef, expiresAt: issued.expiresAt });
      expect((await send(host.endpoint, issued.key!)).status).toBe(200);
      await control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef });
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture().mesh });
      expect((await send(host.endpoint, issued.key!)).status).toBe(401);
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('refuses a second writer without unlinking the first host control socket', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-writer-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    const host = await startGatewayHost(options);
    try {
      await expect(startGatewayHost(options)).rejects.toMatchObject({ code: 'CONFLICT' });
      expect((await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session)).key).toBeDefined();
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('reports not ready and issues nothing with the wrong key or corrupt state', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-corrupt-'));
    const options = { ownerScopeRef: 'owner-a', stateDir, mesh: durableHostFixture().mesh, listen: { host: '127.0.0.1', port: 0 } };
    let host = await startGatewayHost(options);
    try {
      await createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session);
      await host.stop(); host = await startGatewayHost({ ...options, mesh: durableHostFixture('b').mesh });
      expect((await host.readiness()).ready).toBe(false);
      await expect(createGatewayControlClient({ controlSocket: host.controlSocket }).acquireSession(session)).rejects.toMatchObject({ code: 'STORE-FAILED' });
      await host.stop().catch(() => undefined);
      await writeFile(join(stateDir, 'gateway-state.enc'), 'corrupt');
      host = await startGatewayHost(options); expect((await host.readiness()).ready).toBe(false);
      expect(await readFile(join(stateDir, 'gateway-state.enc'), 'utf8')).toBe('corrupt');
    } finally { await host.stop().catch(() => undefined); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('fences stale host-lock takeover so concurrent restarts elect one writer and preserve durable state', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-takeover-'));
    const base = { stateDir, listen: { host: '127.0.0.1', port: 0 } };
    const initial = await startGatewayHost({ ...base, mesh: durableHostFixture().mesh });
    let activeKey = ''; let revokedKey = ''; let receiptId = '';
    try {
      const control = createGatewayControlClient({ controlSocket: initial.controlSocket });
      const active = await control.acquireSession(session);
      const toRevoke = await control.acquireSession({ ...session, clientSessionRef: 'c-revoked' });
      activeKey = active.key!; revokedKey = toRevoke.key!;
      const res = await send(initial.endpoint, activeKey);
      expect(res.status).toBe(200);
      receiptId = res.headers.get('x-sentropic-receipt')!;
      await control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: toRevoke.sessionRef });
    } finally { await initial.stop(); }
    await writeFile(join(stateDir, '.host-lock'), JSON.stringify({ pid: 999_999_999, token: 'crashed-host', startedAt: 1 }), { mode: 0o600 });
    const contenders = await Promise.allSettled([
      startGatewayHost({ ...base, mesh: durableHostFixture().mesh }),
      startGatewayHost({ ...base, mesh: durableHostFixture().mesh }),
      startGatewayHost({ ...base, mesh: durableHostFixture().mesh }),
    ]);
    const winners = contenders.filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof startGatewayHost>>> => r.status === 'fulfilled');
    const losers = contenders.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    try {
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(2);
      for (const loser of losers) expect(loser.reason).toMatchObject({ code: 'CONFLICT' });
      const winner = winners[0]!.value;
      const control = createGatewayControlClient({ controlSocket: winner.controlSocket });
      expect((await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement).toBe('stop');
      expect((await send(winner.endpoint, activeKey)).status).toBe(200);
      expect((await send(winner.endpoint, revokedKey)).status).toBe(401);
    } finally {
      await Promise.all(winners.map((w) => w.value.stop().catch(() => undefined)));
      await rm(stateDir, { recursive: true, force: true });
    }
  });
  it('completes 8 concurrent multi-session HTTP inferences and control operations without CAS exhaustion', async () => {
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-concurrent-'));
    const fixture = durableHostFixture();
    const host = await startGatewayHost({ stateDir, mesh: fixture.mesh, listen: { host: '127.0.0.1', port: 0 } });
    try {
      const control = createGatewayControlClient({ controlSocket: host.controlSocket });
      const sessions = await Promise.all(
        Array.from({ length: 8 }, (_, idx) => control.acquireSession({ ...session, clientSessionRef: `c-${idx}` })),
      );
      const extraSessionPromise = control.acquireSession({ ...session, clientSessionRef: 'c-control' });
      const responses = await Promise.all(sessions.map((s) => send(host.endpoint, s.key!)));
      const extraSession = await extraSessionPromise;
      expect(extraSession.key).toBeTruthy();
      for (const res of responses) {
        const body = await res.text();
        expect(res.status, body).toBe(200);
      }
      expect(fixture.calls).toHaveLength(8);
      const receipts = await Promise.all(
        responses.map((res) => control.readReceipt({ ownerScopeRef: 'owner-a', receiptId: res.headers.get('x-sentropic-receipt')! })),
      );
      expect(receipts.map((r) => r.settlement)).toEqual(Array(8).fill('stop'));
    } finally { await host.stop(); await rm(stateDir, { recursive: true, force: true }); }
  });
  it('restarts cleanly after SIGKILL of a live host holder and >32 crashed recovery acquirers without restart blockage', async () => {
    const { spawn } = await import('node:child_process');
    const { readFile, readdir, writeFile } = await import('node:fs/promises');
    const stateDir = await mkdtemp(join(tmpdir(), 'gw-sigkill-restart-'));
    const modDir = await mkdtemp(join(tmpdir(), 'gw-sigkill-mod-'));
    const copyTs = async (rel: string, out: string) =>
      writeFile(join(modDir, out), (await readFile(new URL(rel, import.meta.url), 'utf8')).replace('../ports/gateway-state.js', './gateway-state.ts'));
    await Promise.all([copyTs('../src/ports/gateway-state.ts', 'gateway-state.ts'), copyTs('../src/node/gateway-state-store.ts', 'gateway-state-store.ts')]);
    const base = { stateDir, listen: { host: '127.0.0.1', port: 0 } };
    const initial = await startGatewayHost({ ...base, mesh: durableHostFixture().mesh });
    let activeKey = ''; let revokedKey = ''; let receiptId = '';
    try {
      const control = createGatewayControlClient({ controlSocket: initial.controlSocket });
      const active = await control.acquireSession(session);
      const toRevoke = await control.acquireSession({ ...session, clientSessionRef: 'c-revoked-kill' });
      activeKey = active.key!; revokedKey = toRevoke.key!;
      const res = await send(initial.endpoint, activeKey);
      expect(res.status).toBe(200);
      receiptId = res.headers.get('x-sentropic-receipt')!;
      await control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: toRevoke.sessionRef });
    } finally { await initial.stop(); }
    const child = spawn(process.execPath, ['-e', `
      const fs = require('node:fs');
      fs.writeFileSync(${JSON.stringify(join(stateDir, '.host-lock'))}, JSON.stringify({ pid: process.pid, token: 'sigkilled-host', startedAt: Date.now() }), { mode: 0o600 });
      fs.writeFileSync(${JSON.stringify(join(stateDir, '.lock.retire-old-tx'))}, JSON.stringify({ pid: process.pid, token: 'sigkilled-tx-fence', startedAt: Date.now() }), { mode: 0o600 });
      process.stdout.write('HELD\\n');
      setInterval(() => {}, 1000);
    `], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('HELD')) resolve(); });
    });
    await expect(startGatewayHost({ ...base, mesh: durableHostFixture().mesh })).rejects.toMatchObject({ code: 'CONFLICT' });
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    for (let i = 0; i < 36; i += 1) {
      const script = `import * as fs from 'node:fs/promises'; import { FileGatewayStateStore } from ${JSON.stringify(join(modDir, 'gateway-state-store.ts'))};
        const store = new FileGatewayStateStore({ stateDir: ${JSON.stringify(stateDir)}, keyring: { getSecret: async () => ${JSON.stringify(Buffer.alloc(32, 7).toString('hex'))} }, fsOps: { link: async (s, d) => { await fs.link(s, d); if (String(d).includes('.retire-')) { setInterval(() => {}, 1000); process.stdout.write('FENCE_READY\\n'); await new Promise(() => {}); } } } });
        await store.claimWriter();`;
      const crasher = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
      await new Promise<void>((resolve, reject) => {
        crasher.once('error', reject);
        crasher.once('exit', (code, sig) => reject(new Error(`crasher exited before FENCE_READY (${code ?? sig})`)));
        crasher.stdout.on('data', (chunk: Buffer) => { if (chunk.toString().includes('FENCE_READY')) resolve(); });
      });
      crasher.kill('SIGKILL');
      await new Promise<void>((resolve) => crasher.once('exit', () => resolve()));
    }
    expect((await readdir(stateDir)).filter((f) => f.startsWith('.host-lock.retire-'))).toHaveLength(36);
    const restarted = await startGatewayHost({ ...base, mesh: durableHostFixture().mesh });
    try {
      expect((await restarted.readiness()).ready).toBe(true);
      const control = createGatewayControlClient({ controlSocket: restarted.controlSocket });
      expect((await control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement).toBe('stop');
      expect((await send(restarted.endpoint, activeKey)).status).toBe(200);
      expect((await send(restarted.endpoint, revokedKey)).status).toBe(401);
      const files = await readdir(stateDir);
      expect(files.filter((f) => f.includes('.retire-') || f.endsWith('.claim'))).toEqual([]);
    } finally {
      await restarted.stop();
      await rm(stateDir, { recursive: true, force: true });
      await rm(modDir, { recursive: true, force: true });
    }
  }, 30_000);
});
