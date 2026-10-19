import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { ProfileId } from '../../src/storage/profiles.js';
import { createSqliteKernel } from '../../src/storage/sqlite/index.js';
import { createSqliteFixture } from './sqlite-fixture.js';
import { grantFor } from './authority-corpus.js';

const record = (id: string) => ({ id, bytes: '{"n":1}', hash: `hash-${id}` });
const absent = { kind: 'absent' as const, allocation: '0' };

describe('SQLite bound profile and capability boundaries', () => {
  it('should advertise and negotiate only the durable subset on bound handles', () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      assert.deepEqual(b.profiles, f.kernel.profiles(true));
      for (const profile of ['immutable-boundaries-v1', 'scope-outbox-v1', 'visibility-barriers-v1', 'staged-units-v1', 'fenced-writers-v1', 'purge-jobs-v1']) {
        assert.throws(() => b.capability(profile as ProfileId), { name: 'UnsupportedProfileError' });
      }
      for (const claim of b.profiles) {
        assert.equal(b.capability(claim.profile).digest, claim.digest);
      }
    } finally { f.close(); }
  });

  it('should persist a capability append before acknowledging success', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      await b.capability('immutable-chains-v1').port.appendChain('port-write', record('port-write'), absent);
      const disk = f.kernel.engine.db.prepare('SELECT state FROM cm_scopes').all() as { state: string }[];
      assert.ok(disk.some(row => row.state.includes('hash-port-write')));
      assert.equal(await b.readHead('port-write'), 'hash-port-write');
    } finally { f.close(); }
  });

  it('should withhold the boundary profile on a reopened store with retained chains', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-sqlite-'));
    const options = { path: join(dir, 'store.db'), moduleId: 'comments', incarnation: 'review-store', cursorSecret: 'review-secret' };
    const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
    const first = createSqliteKernel(options);
    let second: ReturnType<typeof createSqliteKernel> | undefined;
    try {
      const b = first.bindNew(grant) as RootScopedRuntime;
      await b.appendChain('seed', record('seed'), absent);
      assert.throws(() => b.capability('immutable-boundaries-v1'), { name: 'UnsupportedProfileError' });
      first.close();
      second = createSqliteKernel(options);
      const reopened = second.bindNew(grant) as RootScopedRuntime;
      assert.equal(await reopened.readHead('seed'), 'hash-seed');
      assert.equal(second.incarnation, first.incarnation);
      assert.throws(() => reopened.capability('immutable-boundaries-v1'), { name: 'UnsupportedProfileError' });
    } finally { second?.close(); first.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('should withhold new boundary manifests on a reopened populated store', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cm-sqlite-'));
    const options = { path: join(dir, 'store.db'), moduleId: 'comments', incarnation: 'review-store', cursorSecret: 'review-secret' };
    const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
    const first = createSqliteKernel(options);
    let second: ReturnType<typeof createSqliteKernel> | undefined;
    try {
      await (first.bindNew(grant) as RootScopedRuntime).appendChain('seed', record('seed'), absent);
      first.close();
      second = createSqliteKernel(options);
      const reopened = second.bindNew(grant) as RootScopedRuntime;
      assert.equal(await reopened.readHead('seed'), 'hash-seed');
      assert.throws(() => reopened.capability('immutable-boundaries-v1'), { name: 'UnsupportedProfileError' });
    } finally { second?.close(); first.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  it('should revoke saved capability readers and writers after terminal loss', async () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      const cap = b.capability('immutable-chains-v1');
      await cap.port.appendChain('seed', record('seed'), absent);
      f.kernel.engine.db.exec("UPDATE cm_ownership SET epoch = '999' WHERE id = 1");
      await assert.rejects(b.readHead('seed'), { code: 'terminal-loss' });
      await assert.rejects(cap.port.readChain('seed'), { code: 'terminal-loss' });
      await assert.rejects(cap.port.appendChain('stale-port', record('stale-port'), absent), { code: 'terminal-loss' });
    } finally { f.close(); }
  });
});
