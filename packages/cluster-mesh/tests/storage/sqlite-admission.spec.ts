import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import { createSqliteFixture } from './sqlite-fixture.js';

const record = (id: string) => ({ id, bytes: '{"n":1}', hash: `hash-${id}` });
const absent = { kind: 'absent' as const, allocation: '0' };

describe('SQLite independent admission and persistence rollback', () => {
  it('should preserve accepted writes after a refused overlapping append', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      const other = f.kernel.bind(f.grant()) as RootScopedRuntime;
      await b.appendChain('seed', record('seed'), absent);
      f.kernel.engine.db.exec("CREATE TRIGGER refuse_once BEFORE INSERT ON cm_scopes BEGIN SELECT RAISE(ABORT, 'one-shot refusal'); END");
      const results = await Promise.allSettled([
        b.appendChain('rejected', record('rejected'), absent),
        other.appendChain('accepted', record('accepted'), absent),
      ]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');
      assert.equal((results[1] as PromiseRejectedResult).reason.code, 'instance-busy');
      f.kernel.engine.db.exec('DROP TRIGGER refuse_once');
      await other.appendChain('accepted', record('accepted'), absent);
      assert.equal(await b.readHead('accepted'), 'hash-accepted');
      assert.equal(await b.readHead('rejected'), null);
      const disk = f.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(disk.some(row => row.state.includes('hash-accepted')));
      assert.ok(disk.every(row => !row.state.includes('hash-rejected')));
    } finally { f.close(); }
  });

  it('should refuse a concurrent reader before rejected bytes escape', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      await b.appendChain('seed', record('seed'), absent);
      f.kernel.engine.db.exec("CREATE TRIGGER refuse BEFORE INSERT ON cm_scopes BEGIN SELECT RAISE(ABORT, 'refusal'); END");
      const results = await Promise.allSettled([
        b.appendChain('rejected', record('rejected'), absent),
        b.readHead('rejected'),
      ]);
      assert.equal(results[0].status, 'rejected');
      assert.equal(results[1].status, 'rejected');
      assert.equal((results[1] as PromiseRejectedResult).reason.code, 'instance-busy');
      assert.equal(await b.readHead('rejected'), null);
      f.kernel.engine.db.exec('DROP TRIGGER refuse');
    } finally { f.close(); }
  });
});
