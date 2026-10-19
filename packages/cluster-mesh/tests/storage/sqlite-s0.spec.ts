import assert from 'node:assert/strict';
import { closeSync, openSync, statfsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import { openSqliteEngine } from '../../src/storage/sqlite/engine.js';
import { createSqliteFixture } from './sqlite-fixture.js';

const contenderSource = `
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('.js')) { try { return next(specifier.slice(0, -3) + '.ts', context); } catch {} }
  return next(specifier, context);
} });
const { openSqliteEngine } = await import(process.argv[2]);
try {
  const e = openSqliteEngine({ path: process.argv[1] });
  console.log(JSON.stringify({ acquired: true, epoch: e.receipt.storageEpoch })); e.close();
} catch (error) { console.log(JSON.stringify({ acquired: false, code: error.code })); }
`;
const contender = (path: string): { acquired: boolean; epoch?: string; code?: string } => {
  const engine = new URL('../../src/storage/sqlite/engine.ts', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', contenderSource, path, engine], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout);
};
const record = (id: string) => ({ id, bytes: '{"n":1}', hash: `hash-${id}` });
const absent = { kind: 'absent' as const, allocation: '0' };

describe('SQLite S0 process-isolated possession', () => {
  it('should retain exclusive possession after late foreign-close interference', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      await b.appendChain('seed', record('seed'), absent);
      let successor: ReturnType<typeof contender> | undefined;
      f.kernel.engine.db.function('close_after_check', () => {
        closeSync(openSync(f.path, 'r'));
        successor = contender(f.path);
        return 0;
      });
      f.kernel.engine.db.exec('CREATE TRIGGER late_close BEFORE INSERT ON cm_scopes BEGIN SELECT close_after_check(); END');
      await b.appendChain('late-loss', record('late-loss'), absent);
      assert.deepEqual(successor, { acquired: false, code: 'instance-busy' });
      assert.equal(await b.readHead('late-loss'), 'hash-late-loss');
      const rows = f.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(rows.some(row => row.state.includes('hash-late-loss')));
      f.kernel.engine.db.exec('DROP TRIGGER late_close');
      console.log('SQLite S0 late-close PASS', JSON.stringify({ ...f.kernel.engine.receipt, filesystem: statfsSync(f.path).type }));
    } finally { f.close(); }
  });

  it('should exclude contenders between transactions and across a checkpoint', async () => {
    const f = createSqliteFixture();
    try {
      assert.throws(() => openSqliteEngine({ path: f.path }), { code: 'instance-busy' });
      assert.deepEqual(contender(f.path), { acquired: false, code: 'instance-busy' });
      f.kernel.engine.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      assert.deepEqual(contender(f.path), { acquired: false, code: 'instance-busy' });
      f.kernel.close();
      assert.deepEqual(contender(f.path), { acquired: true, epoch: '2' });
    } finally { f.close(); }
  });

  it('should make writer death terminal and recover committed data at a higher epoch', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      await b.appendChain('seed', record('seed'), absent);
      process.kill(f.kernel.engine.receipt.ownerPid, 'SIGKILL');
      // EOF is the release barrier: the fixed owner cannot keep its lock
      // after its pipe closes. No timeout or sleep stands in for that event.
      assert.throws(() => f.kernel.engine.db.exec('SELECT 1'), { code: 'terminal-loss' });
      await assert.rejects(b.readHead('seed'), { code: 'terminal-loss' });
      f.kernel.close();
      const next = openSqliteEngine({ path: f.path });
      try {
        assert.equal(next.receipt.storageEpoch, '2');
        const rows = next.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
        assert.ok(rows.some(row => row.state.includes('hash-seed')));
      } finally { next.close(); }
    } finally { f.close(); }
  });
});
