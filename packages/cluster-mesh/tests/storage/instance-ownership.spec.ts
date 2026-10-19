// Canonical instance ownership and G3 commit fencing (lot 1).
// Registry unit behavior plus the storage-carried checks on SQLite and,
// when a live database is present, on Postgres.

import assert from 'node:assert/strict';
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
import { createSqliteFixture } from './sqlite-fixture.js';

describe('canonical instance ownership', () => {
  it('carries a versioned digest contract', () => {
    assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.name, 'CanonicalInstanceOwnershipV1');
    assert.equal(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.version, '1');
    assert.match(CANONICAL_INSTANCE_OWNERSHIP_CONTRACT.digest, /^[0-9a-f]{64}$/);
  });

  it('refuses a second live holder and supersedes monotonically', () => {
    const registry = new CanonicalInstanceRegistry();
    const first = registry.acquire('store-a');
    assert.equal(first.storageEpoch, '1');
    assert.throws(() => registry.acquire('store-a'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'instance-busy');
    registry.release(first);
    assert.throws(() => registry.acquire('store-a', '1'), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    const second = registry.acquire('store-a');
    assert.equal(second.storageEpoch, '2');
    assert.throws(() => registry.verify(first), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'stale-epoch');
    registry.verify(second);
    commitPossessionGuard(registry, second)();
  });

  it('makes loss terminal and revokes the holder', () => {
    const registry = new CanonicalInstanceRegistry();
    const holder = registry.acquire('store-b');
    registry.markTerminal(holder);
    assert.equal(registry.current('store-b'), null);
    assert.throws(() => registry.verify(holder), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss');
    assert.throws(() => commitPossessionGuard(registry, holder)(), (error: unknown) => error instanceof CanonicalOwnershipError && error.code === 'terminal-loss');
  });

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
