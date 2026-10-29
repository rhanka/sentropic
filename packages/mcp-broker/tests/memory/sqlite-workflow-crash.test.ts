import { expect, it } from 'vitest';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { SqliteMemoryWorkflowStoreV1 } from '../../src/memory-reference/index.js';
import { workflowInput } from './workflow-fixture.js';
it('P06.broker.sqlite-workflow-crash: should retain the reservation and refuse a new claim after process termination during execution', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-crash-')), path = join(dir, 'workflow.sqlite');
  const child = fork(new URL('./fixtures/workflow-child.mjs', import.meta.url), [path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const message = once(child, 'message'); child.send({ input: workflowInput() });
    const [row] = await message;
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    const store = await SqliteMemoryWorkflowStoreV1.open(path);
    try {
      expect(store.read(row.key, true)?.state).toBe('executing');
      expect(() => store.claim(row.key, 'replacement', 40000, 30000, true)).toThrow('MUTATION_OUTCOME_UNKNOWN');
    } finally { store.close(); }
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});
it('P06.broker.sqlite-workflow-crash: should refuse an independent process while the first lease is live', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-contention-')), path = join(dir, 'workflow.sqlite');
  const children: ReturnType<typeof fork>[] = [];
  const probe = async () => {
    const child = fork(new URL('./fixtures/workflow-child.mjs', import.meta.url), [path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.push(child); const message = once(child, 'message'); child.send({ input: workflowInput() });
    return (await message)[0];
  };
  try {
    const original = await probe(); expect(original.key).toBeTypeOf('string');
    expect(await probe()).toEqual({ code: 'FENCE_LOST' });
  } finally {
    await Promise.all(children.map(async child => {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit; }
    }));
    rmSync(dir, { recursive: true, force: true });
  }
});
it('P06.broker.sqlite-workflow-crash: should retain an unclaimed reservation across process termination', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'l5-before-claim-')), path = join(dir, 'workflow.sqlite');
  const child = fork(new URL('./fixtures/workflow-child.mjs', import.meta.url), [path], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  try {
    const message = once(child, 'message'); child.send({ input: workflowInput(), phase: 'reserved' });
    const [row] = await message, exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
    const store = await SqliteMemoryWorkflowStoreV1.open(path);
    try { expect(store.claim(row.key, 'replacement', 40000, 30000, true).fence).toBe(1); }
    finally { store.close(); }
  } finally { child.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); }
});
