import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import { originalModuleResult, recoveryIdentity, recoveryUnit, runCommitResultCorpus } from './commit-result-corpus.js';
import { createMemoryCommitResultRecovery } from '../../src/engram-memory/commit-result-recovery.js';
import { createPostgresKernel } from '../../src/storage/postgres/index.js';

const fence = { fenceId: 'recovery', epoch: '1' };
const child = (name: string, phase: 'commit' | 'recover') => new Promise<{ signal: string | null; output: string }>((resolve, reject) => {
  const hooks = `import { registerHooks } from 'node:module';
    registerHooks({ resolve(s,c,n) { try { return n(s,c); } catch(e) {
      if (s.endsWith('.js') && s.startsWith('.')) return n(s.slice(0,-3)+'.ts',c); throw e;
    } } });`;
  const proc = spawn(process.execPath, ['--experimental-transform-types', '--import',
    `data:text/javascript,${encodeURIComponent(hooks)}`, new URL('./commit-result-process.ts', import.meta.url).pathname, name, phase],
  { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; let errors = '';
  proc.stdout.on('data', (data) => { output += String(data); });
  proc.stderr.on('data', (data) => { errors += String(data); });
  proc.on('error', reject);
  proc.on('close', (code, signal) => code === 0 || signal === 'SIGKILL'
    ? resolve({ signal, output }) : reject(new Error(errors)));
});

describe.skipIf(!pgEnabled)('Postgres original-result recovery', () => {
  it('should return exact immutable results and refuse conflicting intents', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor(); const bound = await root.bindNew(grant);
      await root.provisionFence(grant, fence);
      const recover = createMemoryCommitResultRecovery(bound, async () => fence);
      await runCommitResultCorpus({ commit: (unit, idempotencyKey) => bound.commitAtomic(unit, { idempotencyKey, fence }), recover });
      const { moduleResult: _result, ...withoutResult } = recoveryUnit();
      await bound.commitAtomic(withoutResult, { idempotencyKey: 'no-result', fence });
      await expect(recover('no-result')).rejects.toMatchObject({ code: 'unavailable' });
      await expect(recover('')).rejects.toMatchObject({ code: 'invalid-command' });
    } finally { await fixture.close(); }
  });

  it('should recover after COMMIT before ACK in a new process and epoch', async () => {
    const fixture = await createPgFixture();
    try {
      expect((await child(fixture.name, 'commit')).signal).toBe('SIGKILL');
      const result = await child(fixture.name, 'recover');
      expect(JSON.parse(result.output)).toEqual({ result: originalModuleResult, epoch: '2' });
    } finally { await fixture.close(); }
  });

  it('should enforce current grants and fences before returning results or absence', async () => {
    let now = '2026-10-23T00:00:00.000Z';
    const fixture = await createPgFixture({ now: () => now });
    try {
      const root = await fixture.open(); const grant = grantFor(); const bound = await root.bindNew(grant);
      await root.provisionFence(grant, fence);
      await bound.commitAtomic(recoveryUnit(), { idempotencyKey: recoveryIdentity, fence });
      const successor = { ...fence, epoch: '2' };
      await root.provisionFence(grant, successor);
      for (const identity of [recoveryIdentity, 'absent']) {
        await expect(bound.readCommitResult(identity, fence)).rejects.toMatchObject({ code: 'invalid-command' });
        await expect(bound.readCommitResult(identity, undefined!)).rejects.toMatchObject({ code: 'invalid-command' });
      }
      expect(await bound.readCommitResult(recoveryIdentity, successor)).toEqual(originalModuleResult);
      const writer = await root.bindNew(grantFor({ token: 'write-only', operations: ['write'] }));
      await expect(writer.readCommitResult(recoveryIdentity, successor)).rejects.toMatchObject({ code: 'denied' });
      const leased = await root.bindNew(grantFor({ token: 'leased', lifetime: { kind: 'lease', expiresAt: '2026-10-24T00:00:00.000Z' } }));
      now = '2026-10-25T00:00:00.000Z';
      await expect(leased.readCommitResult(recoveryIdentity, successor)).rejects.toMatchObject({ code: 'denied' });
      await root.revoke(grant.token);
      await expect(bound.readCommitResult(recoveryIdentity, successor)).rejects.toMatchObject({ code: 'denied' });
    } finally { await fixture.close(); }
  });

  it('should isolate tenant, workspace and module scopes and propagate transient failures', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open(); const grant = grantFor(); const bound = await root.bindNew(grant);
      await root.provisionFence(grant, fence);
      await bound.commitAtomic(recoveryUnit(), { idempotencyKey: recoveryIdentity, fence });
      for (const scope of [{ tenantId: 'foreign', workspaceId: 'workspace-a' }, { tenantId: 'tenant-a', workspaceId: 'foreign' }]) {
        const foreign = grantFor({ token: JSON.stringify(scope), scope });
        const other = await root.bindNew(foreign); await root.provisionFence(foreign, fence);
        expect(await other.readCommitResult(recoveryIdentity, fence)).toBeNull();
      }
      const memory = await createPostgresKernel({ ...fixture.options, moduleId: 'engram-memory' });
      const memoryGrant = grantFor({ token: 'memory', moduleId: 'engram-memory' });
      const otherModule = await memory.bindNew(memoryGrant); await memory.provisionFence(memoryGrant, fence);
      expect(await otherModule.readCommitResult(recoveryIdentity, fence)).toBeNull();
      let fail = false;
      const failing = await createPostgresKernel({ ...fixture.options, driver: { transaction: async (options, operation) => {
        if (fail) throw Object.assign(new Error('connection lost'), { code: '08006' });
        return fixture.options.driver.transaction(options, operation);
      } } });
      const reader = await failing.bind(grant); fail = true;
      await expect(reader.readCommitResult('absent', fence)).rejects.toMatchObject({ code: 'unavailable', condition: 'unavailable' });
      expect(await bound.readCommitResult('absent', fence)).toBeNull();
    } finally { await fixture.close(); }
  });
});
