import assert from 'node:assert/strict';
import { linkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import { openSqliteEngine } from '../../src/storage/sqlite/engine.js';
import { createSqliteFixture } from './sqlite-fixture.js';

describe('SQLite S0 store identity and alias policy', () => {
  it('should canonicalize symlinks and refuse unqualified hard links before opening', () => {
    const f = createSqliteFixture();
    try {
      const symbolic = join(f.dir, 'symbolic.db');
      symlinkSync(f.path, symbolic);
      assert.throws(() => openSqliteEngine({ path: symbolic }), { code: 'instance-busy' });
      const hard = join(f.dir, 'hard.db');
      linkSync(f.path, hard);
      assert.throws(() => openSqliteEngine({ path: hard }), { code: 'open-refused' });
      assert.throws(() => f.kernel.engine.assertOwnership(), { code: 'terminal-loss' });
      unlinkSync(hard);
      // Removing the alias cannot resurrect an invalidated instance.
      assert.throws(() => f.kernel.engine.assertOwnership(), { code: 'terminal-loss' });
    } finally { f.close(); }
  });

  for (const replacement of [false, true]) {
    it(`should revoke readers and writes when the store is ${replacement ? 'replaced' : 'renamed'}`, async () => {
      const f = createSqliteFixture();
      try {
        const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
        await b.appendChain('seed', { id: 'seed', bytes: '{}', hash: 'hash-seed' }, { kind: 'absent', allocation: '0' });
        renameSync(f.path, join(f.dir, 'moved.db'));
        if (replacement) writeFileSync(f.path, 'replacement');
        await assert.rejects(b.readHead('seed'), { code: 'terminal-loss' });
        if (replacement) unlinkSync(f.path);
        renameSync(join(f.dir, 'moved.db'), f.path);
        await assert.rejects(b.readHead('seed'), { code: 'terminal-loss' });
        await assert.rejects(b.appendChain('stale', { id: 'stale', bytes: '{}', hash: 'hash-stale' }, { kind: 'absent', allocation: '0' }), { code: 'terminal-loss' });
      } finally { f.close(); }
    });
  }
});
