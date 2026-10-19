import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { KernelTransaction } from '../../src/storage/scope-runtime.js';
import { createSqliteFixture } from './sqlite-fixture.js';

describe('SQLite transaction dependent readers', () => {
  for (const mode of ['before', 'prepared', 'descriptor']) {
    it(`should refuse ownership loss through a ${mode} callback read`, async () => {
      const f = createSqliteFixture();
      try {
        const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
        await b.appendChain('seed', { id: 'seed', bytes: '{}', hash: 'hash-seed' }, { kind: 'absent', allocation: '0' });
        let leaked: unknown = null;
        await assert.rejects(b.transact({}, async tx => {
          const read = mode === 'descriptor' ? Object.getOwnPropertyDescriptor(tx, 'readHead')!.value : tx.readHead;
          const pending = mode === 'prepared' ? read('seed') : null;
          f.kernel.engine.db.exec("UPDATE cm_ownership SET epoch = '999' WHERE id = 1");
          leaked = await (pending ?? read('seed'));
        }), { code: 'terminal-loss' });
        assert.equal(leaked, null);
      } finally { f.close(); }
    });
  }

  it('should revoke a transaction port after its callback returns', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      let saved!: KernelTransaction;
      await assert.rejects(b.transact({}, async tx => { saved = tx; }));
      await assert.rejects(saved.readHead('seed'), { code: 'terminal-loss' });
    } finally { f.close(); }
  });
});
