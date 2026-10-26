// E2 exact-u64 persistence on PostgreSQL: codec, publication counters,
// epochs and aggregate versions/guards across the signed-64 boundary to the
// u64 maximum, with reopen and rollback. A decimal string converted to
// Number or to signed BIGINT must fail.
import { describe, expect, it } from 'vitest';
import { decodePgCounter, decodePgCounterU64 } from '../../src/storage/postgres/codec.js';
import { pgSafeCounter } from '../../src/storage/postgres/journal.js';
import { createPgFixture } from './pg-fixture.js';
import { pgEnabled } from './pg-driver.js';
import { grantFor } from './authority-corpus.js';
import type { WriterFence } from '../../src/storage/contracts.js';
import type { AtomicUnit } from '../../src/storage/atomic.js';

const U64_MAX = '18446744073709551615';
const SIGNED_MAX = '9223372036854775807';

const recordUnit = (): AtomicUnit => ({ guards: [], records: [{ key: 'u64-record', contentHash: 'h', bytes: { format: 'utf8', data: 'v' } }], appends: [], updates: [], relationships: [], barriers: [], purgeIntents: [], indexWrites: [] });

describe('exact-u64 counter codec', () => {
  it('decodes the full u64 range and never converts through Number', () => {
    expect(decodePgCounterU64('0')).toBe('0');
    expect(decodePgCounterU64('9007199254740991')).toBe('9007199254740991');
    expect(decodePgCounterU64('9007199254740992')).toBe('9007199254740992');
    expect(decodePgCounterU64(SIGNED_MAX)).toBe(SIGNED_MAX);
    expect(decodePgCounterU64('9223372036854775808')).toBe('9223372036854775808');
    expect(decodePgCounterU64(U64_MAX)).toBe(U64_MAX);
    expect(decodePgCounterU64(18446744073709551615n)).toBe(U64_MAX);
    expect(() => decodePgCounterU64(42)).toThrow();
    expect(() => decodePgCounterU64(9007199254740991)).toThrow();
    expect(() => decodePgCounterU64('')).toThrow();
    expect(() => decodePgCounterU64('01')).toThrow();
    expect(() => decodePgCounterU64('-1')).toThrow();
    expect(() => decodePgCounterU64('18446744073709551616')).toThrow();
    expect(() => decodePgCounterU64(-1n)).toThrow();
    expect(() => decodePgCounterU64(18446744073709551616n)).toThrow();
  });
  it('keeps the legacy safe decoder frozen', () => {
    expect(decodePgCounter('9007199254740991')).toBe('9007199254740991');
    expect(decodePgCounter('9007199254740992')).toBe('9007199254740992');
    expect(() => pgSafeCounter('9007199254740992')).toThrow();
  });
});

describe.skipIf(!pgEnabled)('exact-u64 persistence on PostgreSQL', () => {
  it.each([undefined, [1], [''], ['r', 'r'], [null], ['r', undefined]])('refuses invalid index result ids %j before persistence', async (resultIds) => {
    let effects = 0;
    const fixture = await createPgFixture({ validateEffects: async () => { effects += 1; } });
    try {
      const bound = await (await fixture.open()).bindNew(grantFor({ operations: ['read', 'write'] }));
      for (const version of [1, '9223372036854775808']) {
        const unit = { ...recordUnit(), updates: [{ key: 'k3', version, value: { format: 'utf8', data: 'v' } }], indexWrites: [{ key: 'bad', digest: 'd', resultIds, resultHash: null }] } as unknown as AtomicUnit;
        await expect(bound.commitAtomic(unit)).rejects.toMatchObject({ code: 'invalid-command' });
      }
      expect(effects).toBe(0);
      expect(await bound.indexGet('bad')).toBeNull();
      expect(await bound.readRecord('u64-record')).toBeNull();
      expect(await readCounters(fixture)).toEqual({ version: '0', sequence: '0' });
    } finally { await fixture.close(); }
  });
  it('refuses decimal strings converted to Number or to signed BIGINT', async () => {
    expect(() => pgSafeCounter('9007199254740992')).toThrow();
    const fixture = await createPgFixture();
    try {
      await expect(fixture.tx.run(true, (session) => session.execute({ text: 'SELECT $1::bigint', values: ['9223372036854775808'] }))).rejects.toThrow();
      await expect(fixture.tx.run(true, (session) => session.execute({ text: 'SELECT $1::numeric', values: [U64_MAX] }))).resolves.toBeDefined();
    } finally { await fixture.close(); }
  });
  it('publishes publication counters across the signed-64 boundary', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write'] }));
      await bound.commitAtomic(recordUnit());
      await seedCounters(fixture, SIGNED_MAX);
      await bound.commitAtomic(recordUnit());
      expect(await readCounters(fixture)).toEqual({ version: '9223372036854775808', sequence: '9223372036854775808' });
      expect(await journalTail(fixture)).toBe('9223372036854775808');
      const reopened = await fixture.open();
      const rebound = await reopened.bindNew(grantFor({ operations: ['read', 'write'] }));
      expect(await readCounters(fixture)).toEqual({ version: '9223372036854775808', sequence: '9223372036854775808' });
      await expect(rebound.commitAtomic({
        ...recordUnit(),
        guards: [{ kind: 'aggregate-version', key: 'missing', version: 1 }],
      })).rejects.toMatchObject({ code: 'cas-conflict' });
      expect(await readCounters(fixture)).toEqual({ version: '9223372036854775808', sequence: '9223372036854775808' });
    } finally { await fixture.close(); }
  });
  it('persists the u64 maximum and refuses beyond exhaustion', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write'] }));
      await bound.commitAtomic(recordUnit());
      await seedCounters(fixture, '18446744073709551614');
      await bound.commitAtomic(recordUnit());
      expect(await readCounters(fixture)).toEqual({ version: U64_MAX, sequence: U64_MAX });
      await expect(bound.commitAtomic(recordUnit())).rejects.toMatchObject({ code: 'capacity-exceeded' });
      expect(await readCounters(fixture)).toEqual({ version: U64_MAX, sequence: U64_MAX });
    } finally { await fixture.close(); }
  });
  it('provisions exact u64 fence epochs', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const grant = grantFor({ operations: ['read', 'write', 'maintain'] });
      await root.bindNew(grant);
      await root.provisionFence(grant, { fenceId: 'u64', epoch: '9223372036854775808' } as unknown as WriterFence);
      await expect(root.provisionFence(grant, { fenceId: 'u64', epoch: '1' } as unknown as WriterFence)).rejects.toMatchObject({ code: 'invalid-command' });
      const reopened = await fixture.open();
      await expect(reopened.provisionFence(grant, { fenceId: 'u64', epoch: '2' } as unknown as WriterFence)).rejects.toMatchObject({ code: 'invalid-command' });
      await reopened.provisionFence(grant, { fenceId: 'u64', epoch: U64_MAX } as unknown as WriterFence);
      expect(await readEpoch(fixture)).toBe(U64_MAX);
    } finally { await fixture.close(); }
  });
  it('applies u64 aggregate versions and guards exactly', async () => {
    const fixture = await createPgFixture();
    try {
      const root = await fixture.open();
      const bound = await root.bindNew(grantFor({ operations: ['read', 'write'] }));
      const value = { format: 'utf8', data: 'k3-state' } as const;
      await bound.commitAtomic({ ...recordUnit(), updates: [{ key: 'k3', version: '9007199254740992' as unknown as number, value }] } as unknown as AtomicUnit);
      await bound.commitAtomic({ ...recordUnit(), guards: [{ kind: 'aggregate-version', key: 'k3', version: '9007199254740992' as unknown as number }] } as unknown as AtomicUnit);
      await expect(bound.commitAtomic({ ...recordUnit(), updates: [{ key: 'k3', version: '9007199254740992' as unknown as number, value }] } as unknown as AtomicUnit)).rejects.toMatchObject({ code: 'cas-conflict' });
      await bound.commitAtomic({ ...recordUnit(), updates: [{ key: 'k3', version: '9007199254740993' as unknown as number, value }] } as unknown as AtomicUnit);
      const seen = await bound.readAggregate('k3');
      expect(seen?.version).toBe('9007199254740993');
      const reopened = await fixture.open();
      const rebound = await reopened.bindNew(grantFor({ operations: ['read', 'write'] }));
      expect((await rebound.readAggregate('k3'))?.version).toBe('9007199254740993');
    } finally { await fixture.close(); }
  });
});

type Session = { execute(q: { text: string; values: readonly unknown[] }): Promise<{ rows: Array<Record<string, string>> }> };
type Tx = { run(r: boolean, f: (s: Session) => Promise<unknown>): Promise<unknown> };
type Fixture = { tx: Tx; name: string };

const seedCounters = async (fixture: Fixture, value: string) => {
  await fixture.tx.run(false, (session) => session.execute({
    text: `UPDATE "${fixture.name}".scopes SET version=$1, sequence=$1`,
    values: [value],
  }));
};

const readCounters = async (fixture: Fixture) => {
  const result = await fixture.tx.run(true, (session) => session.execute({
    text: `SELECT version::text AS version, sequence::text AS sequence FROM "${fixture.name}".scopes`,
    values: [],
  })) as unknown as { rows: Array<{ version: string; sequence: string }> };
  return result.rows[0] as { version: string; sequence: string };
};

const journalTail = async (fixture: Fixture) => {
  const result = await fixture.tx.run(true, (session) => session.execute({
    text: `SELECT sequence::text AS sequence FROM "${fixture.name}".journal ORDER BY sequence DESC LIMIT 1`,
    values: [],
  })) as unknown as { rows: Array<{ sequence: string }> };
  return result.rows[0]!.sequence;
};

const readEpoch = async (fixture: Fixture) => {
  const result = await fixture.tx.run(true, (session) => session.execute({
    text: `SELECT epoch::text AS epoch FROM "${fixture.name}".fences`,
    values: [],
  })) as unknown as { rows: Array<{ epoch: string }> };
  return result.rows[0]!.epoch;
};
