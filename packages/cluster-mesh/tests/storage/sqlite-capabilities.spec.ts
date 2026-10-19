import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import type { RootScopedRuntime } from '../../src/storage/root-facade.js';
import type { ProfileId } from '../../src/storage/profiles.js';
import { createSqliteFixture } from './sqlite-fixture.js';

const record = (id: string) => ({ id, bytes: '{"n":1}', hash: `hash-${id}` });
const absent = { kind: 'absent' as const, allocation: '0' };

describe('SQLite bound profile and capability boundaries', () => {
  it('should advertise and negotiate only the durable subset on bound handles', () => {
    const f = createSqliteFixture();
    try {
      const b = f.kernel.bindNew(f.grant()) as RootScopedRuntime;
      assert.deepEqual(b.profiles, f.kernel.profiles(true));
      for (const profile of ['scope-outbox-v1', 'visibility-barriers-v1', 'staged-units-v1', 'fenced-writers-v1', 'purge-jobs-v1']) {
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
