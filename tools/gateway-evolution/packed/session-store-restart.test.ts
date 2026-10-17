import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayControlClient } from '@sentropic/llm-gateway/node/control-client';
const session = { ownerScopeRef: 'owner-a', workspaceRef: 'workspace', clientSessionRef: 'native-synthetic', models: ['gpt-6.1-sol'] };
const launch = async (dir: string, children: Set<ChildProcess>, key = 'a'.repeat(64)) => {
  const child = fork(new URL('./host-child.ts', import.meta.url), [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
    env: { ...process.env, GW_TEST_STATE_DIR: dir, GW_TEST_DEK: key } });
  children.add(child); child.once('exit', () => children.delete(child));
  const signal = AbortSignal.timeout(5_000);
  const [message] = await Promise.race([once(child, 'message', { signal }), once(child, 'exit', { signal }).then(() => { throw new Error('packed host exited before readiness'); })]);
  const info = message as { endpoint: string; controlSocket: string; ready: boolean };
  return { ...info, control: createGatewayControlClient({ controlSocket: info.controlSocket }), stop: async () => {
    const exited = once(child, 'exit', { signal: AbortSignal.timeout(5_000) }); child.send({ stop: true });
    const [code] = await exited; assert.equal(code, 0);
  } };
};
const send = (endpoint: string, key: string) => fetch(`${endpoint}/v1/chat/completions`, { method: 'POST',
  headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'gpt-6.1-sol', messages: [{ role: 'user', content: 'synthetic' }] }) });
const reap = async (children: Set<ChildProcess>) => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode !== null) return;
    const exited = once(child, 'exit'); if (child.kill('SIGKILL')) await exited;
  }));
};
it('restarts a real packed Node process with stable keys, receipts and revocation', { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-packed-restart-')); const children = new Set<ChildProcess>();
  t.after(async () => { await reap(children); await rm(dir, { recursive: true, force: true }); });
  const first = await launch(dir, children); assert.equal(first.ready, true);
  const issued = await first.control.acquireSession(session); assert.ok(issued.key);
  const response = await send(first.endpoint, issued.key); assert.equal(response.status, 200); await response.text();
  const receiptId = response.headers.get('x-sentropic-receipt')!; assert.ok(receiptId);
  assert.equal((await first.control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement, 'stop');
  assert.ok(!(await readFile(join(dir, 'gateway-state.enc'), 'utf8')).includes(issued.key));
  await first.stop();
  const second = await launch(dir, children);
  assert.equal((await second.control.acquireSession(session)).key, issued.key);
  assert.equal((await second.control.readReceipt({ ownerScopeRef: 'owner-a', receiptId })).settlement, 'stop');
  await second.control.revokeSession({ ownerScopeRef: 'owner-a', sessionRef: issued.sessionRef }); await second.stop();
  const third = await launch(dir, children);
  const refused = await send(third.endpoint, issued.key); assert.equal(refused.status, 401); await refused.text(); await third.stop();
});
it('keeps a wrong-key or corrupt packed store unavailable without resetting it', { timeout: 5_000 }, async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gw-packed-corrupt-')); const children = new Set<ChildProcess>();
  t.after(async () => { await reap(children); await rm(dir, { recursive: true, force: true }); });
  const first = await launch(dir, children); await first.control.acquireSession(session); await first.stop();
  const wrong = await launch(dir, children, 'b'.repeat(64)); assert.equal(wrong.ready, false);
  await assert.rejects(wrong.control.acquireSession(session), { code: 'STORE-FAILED' }); await wrong.stop();
  await writeFile(join(dir, 'gateway-state.enc'), 'corrupt');
  const corrupt = await launch(dir, children); assert.equal(corrupt.ready, false);
  assert.equal(await readFile(join(dir, 'gateway-state.enc'), 'utf8'), 'corrupt'); await corrupt.stop();
});
