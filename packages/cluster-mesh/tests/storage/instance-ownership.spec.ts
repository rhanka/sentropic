// Canonical instance ownership and G3 commit fencing (lot 1).
// Registry unit behavior plus the storage-carried checks on SQLite and,
// when a live database is present, on Postgres.

import assert from 'node:assert/strict';
import { closeSync, openSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_INSTANCE_OWNERSHIP_CONTRACT,
  CanonicalInstanceRegistry,
  CanonicalOwnershipError,
  commitPossessionGuard,
} from '../../src/storage/instance-ownership.js';
import { pgEnabled } from './pg-driver.js';
import { createPgFixture } from './pg-fixture.js';
import { grantFor } from './authority-corpus.js';
import { defineRegistrySemantics } from './instance-corpus.js';
import { createSqliteFixture } from './sqlite-fixture.js';

describe('canonical instance ownership', () => {
  defineRegistrySemantics(() => new CanonicalInstanceRegistry());

  it('refuses SQLite commits after the ownership row moves, without partial persist', async () => {
    const fixture = createSqliteFixture();
    try {
      const grant = fixture.grant();
      const bound = fixture.kernel.bindNew(grant) as unknown as {
        appendChain(id: string, record: { id: string; bytes: string; hash: string }, expectation: { kind: 'absent'; allocation: string }): Promise<unknown>;
        readChain(id: string): Promise<readonly { id: string }[]>;
      };
      await bound.appendChain('fenced', { id: 'f1', bytes: '{"n":1}', hash: 'hash-f-1' }, { kind: 'absent', allocation: '0' });
      fixture.kernel.engine.db.exec("UPDATE cm_ownership SET epoch = '999' WHERE id = 1");
      await expect(bound.appendChain('fenced', { id: 'f2', bytes: '{"n":2}', hash: 'hash-f-2' }, { kind: 'absent', allocation: '0' })).rejects.toMatchObject({
        name: 'CanonicalOwnershipError',
        code: 'terminal-loss',
      });
      await expect(bound.readChain('fenced')).rejects.toMatchObject({ code: 'terminal-loss' });
      const persisted = fixture.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(persisted.length > 0 && persisted.every((row) => !row.state.includes('"f2"')), 'no partial persist survives the refusal');
      await expect(bound.appendChain('fenced', { id: 'f3', bytes: '{"n":3}', hash: 'hash-f-3' }, { kind: 'absent', allocation: '0' })).rejects.toMatchObject({ code: 'terminal-loss' });
    } finally {
      fixture.close();
    }
  });

  it('isolates the writer lock from foreign caller fd closes', async () => {
    const fixture = createSqliteFixture();
    try {
      assert.equal(fixture.kernel.engine.receipt.lockLiveness, 'procfs');
      assert.equal(fixture.kernel.engine.receipt.isolation, 'process');
      assert.notEqual(fixture.kernel.engine.receipt.ownerPid, process.pid);
      const bound = fixture.kernel.bindNew(fixture.grant()) as unknown as {
        appendChain(id: string, record: { id: string; bytes: string; hash: string }, expectation: { kind: 'absent'; allocation: string }): Promise<unknown>;
        readHead(id: string): Promise<string | null>;
      };
      await bound.appendChain('before', { id: 'b1', bytes: '{"n":1}', hash: 'hash-before' }, { kind: 'absent', allocation: '0' });
      const childSource = `
        import { registerHooks } from 'node:module';
        registerHooks({ resolve(specifier, context, next) {
          if (specifier.endsWith('.js')) {
            try { return next(specifier.slice(0, -3) + '.ts', context); } catch {}
          }
          return next(specifier, context);
        } });
        const { openSqliteEngine } = await import(process.argv[2]);
        try {
          const e = openSqliteEngine({ path: process.argv[1] });
          console.log(JSON.stringify({ acquired: true, epoch: e.receipt.storageEpoch }));
          e.close();
        } catch (error) {
          console.log(JSON.stringify({ acquired: false, name: error.name, code: error.code, message: error.message }));
        }
      `;
      const engineUrl = new URL('../../src/storage/sqlite/engine.ts', import.meta.url).href;
      const contender = () =>
        spawnSync(process.execPath, ['--input-type=module', '-e', childSource, fixture.path, engineUrl], { encoding: 'utf8', timeout: 15000 });
      const beforeClose = contender();
      assert.equal(beforeClose.status, 0, beforeClose.stderr);
      const refused = JSON.parse(beforeClose.stdout) as { acquired: boolean; name?: string; code?: string };
      assert.equal(refused.acquired, false);
      assert.equal(refused.name, 'CanonicalOwnershipError');
      assert.equal(refused.code, 'instance-busy');
      const fd = openSync(fixture.path, 'r');
      closeSync(fd);
      const afterClose = contender();
      assert.equal(afterClose.status, 0, afterClose.stderr);
      const successor = JSON.parse(afterClose.stdout) as { acquired: boolean; epoch?: string };
      assert.equal(successor.acquired, false);
      await bound.appendChain('after', { id: 'a1', bytes: '{"n":1}', hash: 'hash-after' }, { kind: 'absent', allocation: '0' });
      assert.equal(await bound.readHead('after'), 'hash-after');
      const persisted = fixture.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(persisted.some((row) => row.state.includes('hash-after')), 'the isolated holder retains possession through commit');
    } finally {
      fixture.close();
    }
  });

  it('rolls back the visible root when SQLite persistence fails', async () => {
    const fixture = createSqliteFixture();
    try {
      const bound = fixture.kernel.bindNew(fixture.grant()) as unknown as {
        appendChain(id: string, record: { id: string; bytes: string; hash: string }, expectation: { kind: 'absent'; allocation: string }): Promise<unknown>;
        readHead(id: string): Promise<string | null>;
      };
      await bound.appendChain('seed', { id: 's1', bytes: '{"n":1}', hash: 'hash-seed' }, { kind: 'absent', allocation: '0' });
      fixture.kernel.engine.db.exec("CREATE TRIGGER refuse_snapshot BEFORE INSERT ON cm_scopes BEGIN SELECT RAISE(ABORT, 'test disk refusal'); END");
      await assert.rejects(
        bound.appendChain('rejected', { id: 'r1', bytes: '{"n":1}', hash: 'hash-rejected' }, { kind: 'absent', allocation: '0' }),
        /test disk refusal/,
      );
      assert.equal(await bound.readHead('seed'), 'hash-seed');
      assert.equal(await bound.readHead('rejected'), null);
      fixture.kernel.engine.db.exec('DROP TRIGGER refuse_snapshot');
      await bound.appendChain('accepted', { id: 'a1', bytes: '{"n":1}', hash: 'hash-accepted' }, { kind: 'absent', allocation: '0' });
      assert.equal(await bound.readHead('rejected'), null);
      const persisted = fixture.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(persisted.length > 0);
      assert.ok(persisted.some((row) => row.state.includes('hash-seed')));
      assert.ok(persisted.some((row) => row.state.includes('hash-accepted')));
      assert.ok(persisted.every((row) => !row.state.includes('hash-rejected')), 'a rejected mutation is never resurrected');
    } finally {
      fixture.close();
    }
  });

  it('invalidates a prepared read when ownership is lost before it resolves', async () => {
    const fixture = createSqliteFixture();
    try {
      const bound = fixture.kernel.bindNew(fixture.grant()) as unknown as {
        appendChain(id: string, record: { id: string; bytes: string; hash: string }, expectation: { kind: 'absent'; allocation: string }): Promise<unknown>;
        readChain(id: string): Promise<readonly { id: string }[]>;
      };
      await bound.appendChain('prepared-read', { id: 'p1', bytes: '{"n":1}', hash: 'hash-prepared' }, { kind: 'absent', allocation: '0' });
      const pending = bound.readChain('prepared-read');
      fixture.kernel.engine.db.exec("UPDATE cm_ownership SET epoch = '999' WHERE id = 1");
      await expect(pending).rejects.toMatchObject({ code: 'terminal-loss' });
      await expect(bound.readChain('prepared-read')).rejects.toMatchObject({ code: 'terminal-loss' });
    } finally {
      fixture.close();
    }
  });
});

describe.skipIf(!pgEnabled)('postgres commit-possession hook', () => {
  it('rolls back when the possession check refuses at the commit point', async () => {
    let armed = false;
    let calls = 0;
    const fixture = await createPgFixture({
      onCommitPossession: () => {
        calls += 1;
        if (armed) throw new CanonicalOwnershipError('terminal-loss', 'test possession lost');
      },
    });
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      armed = true;
      const unit = { guards: [], records: [], appends: [{ chainId: 'hook-chain', record: { id: 'h1', bytes: '{"n":1}', hash: 'hash-h-1' }, expectation: { kind: 'absent', allocation: '0' } as const }], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] };
      try {
        await bound.commitAtomic(unit);
        assert.fail('a refused possession must roll back');
      } catch (error) {
        assert.ok(error instanceof Error && error.name === 'PostgresStorageError');
        const cause = (error as { cause?: unknown }).cause;
        assert.ok(cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss');
      }
      assert.equal(calls, 2);
      assert.equal(await bound.readHead('hook-chain'), null);
    } finally {
      await fixture.close();
    }
  });

  it('refuses after the outbox callback when possession is lost there', async () => {
    let valid = true;
    let armed = false;
    const order: string[] = [];
    const fixture = await createPgFixture({
      onCommitPossession: () => {
        order.push('hook');
        if (!valid) throw new CanonicalOwnershipError('terminal-loss', 'test possession lost');
      },
      outbox: {
        append: async () => { order.push('outbox'); if (armed) valid = false; },
        read: async () => [],
        find: async () => null,
      },
    });
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      order.length = 0;
      armed = true;
      const unit = { guards: [], records: [], appends: [{ chainId: 'after-hook', record: { id: 'h1', bytes: '{"n":1}', hash: 'hash-after-hook' }, expectation: { kind: 'absent', allocation: '0' } as const }], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] };
      await assert.rejects(bound.commitAtomic(unit), (error: unknown) => {
        const cause = (error as { cause?: unknown }).cause;
        return cause instanceof CanonicalOwnershipError && cause.code === 'terminal-loss';
      });
      assert.deepEqual(order, ['outbox', 'hook']);
      assert.equal(valid, false);
      assert.equal(await bound.readHead('after-hook'), null);
    } finally {
      await fixture.close();
    }
  });

  it('commits unchanged when no possession hook is installed', async () => {
    const fixture = await createPgFixture();
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write', 'maintain'] }));
      await bound.configureLifecycle('optional');
      const receipt = await bound.commitAtomic({ guards: [], records: [], appends: [{ chainId: 'plain-chain', record: { id: 'p1', bytes: '{"n":1}', hash: 'hash-p-1' }, expectation: { kind: 'absent', allocation: '0' } as const }], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });
      assert.ok(receipt.commitId.length > 0);
      assert.equal(await bound.readHead('plain-chain'), 'hash-p-1');
    } finally {
      await fixture.close();
    }
  });
});
