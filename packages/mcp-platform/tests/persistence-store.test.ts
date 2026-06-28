/**
 * Slice 3 — generic restart-safe RecordStore probes (§6.3/§6.4 persistence
 * primitive backing §11 "restart lookup").
 *
 * Proves the durable backing genuinely survives a simulated process restart (a
 * brand-new store at the same path), and the non-durable backing round-trips via
 * snapshot/reload. NO real DB — tmp-file JSON only, under the OS tmp dir.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FileRecordStore, MemoryRecordStore } from '../src/persistence.js';

type Row = { id: string; v: number };

const paths: string[] = [];
const tmpPath = (): string => {
  const p = join(tmpdir(), 'sentropic-mcp-platform-test', `s-${randomUUID()}.json`);
  paths.push(p);
  return p;
};

afterEach(() => {
  for (const p of paths.splice(0)) new FileRecordStore(p).destroy();
});

describe('FileRecordStore — durable, restart-safe', () => {
  it('rehydrates a fresh instance at the same path (= process restart)', () => {
    const path = tmpPath();
    const s1 = new FileRecordStore<Row>(path);
    s1.put('a', { id: 'a', v: 1 });
    s1.put('b', { id: 'b', v: 2 });

    const restarted = new FileRecordStore<Row>(path); // simulated restart
    expect(restarted.get('a')).toEqual({ id: 'a', v: 1 });
    expect(restarted.keys().sort()).toEqual(['a', 'b']);
  });

  it('reload() re-reads the durable medium after an out-of-band write', () => {
    const path = tmpPath();
    const reader = new FileRecordStore<Row>(path);
    expect(reader.get('a')).toBeUndefined();
    new FileRecordStore<Row>(path).put('a', { id: 'a', v: 9 }); // another writer
    reader.reload();
    expect(reader.get('a')).toEqual({ id: 'a', v: 9 });
  });

  it('delete persists and a missing file reads as empty (fail to empty, not throw)', () => {
    const path = tmpPath();
    const s = new FileRecordStore<Row>(path);
    s.put('a', { id: 'a', v: 1 });
    s.delete('a');
    expect(new FileRecordStore<Row>(path).get('a')).toBeUndefined();
    expect(new FileRecordStore<Row>(join(tmpdir(), `absent-${randomUUID()}.json`)).all()).toEqual([]);
  });
});

describe('MemoryRecordStore — non-durable, snapshot/restore', () => {
  it('fromSnapshot(snapshot()) reconstructs the records deterministically', () => {
    const s = new MemoryRecordStore<Row>();
    s.put('a', { id: 'a', v: 1 });
    const clone = MemoryRecordStore.fromSnapshot<Row>(s.snapshot());
    expect(clone.get('a')).toEqual({ id: 'a', v: 1 });
    expect(clone.reload()).toBeUndefined(); // no external medium → no-op
  });
});
