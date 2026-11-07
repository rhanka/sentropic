import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, OUTPUT_LIMITS, putWriter, readSnapshot, streamSnapshot, TREE_LIMITS, treeDigest,
  type TransferFile } from '../../../src/services/artifacts/live/supervisor-transfer';
import { MAX_FRAME_BYTES } from '../../../src/services/artifacts/live/supervisor-frame';

const file = (path: string, size: number, mode = 0o644): TransferFile => ({ path, mode, bytes: Buffer.alloc(size, 7) });
const fail = (kind: string): never => { throw new Error(kind); };
/** Serves files as pod snapshot pages: each entry is a slice of at most `slice` bytes. */
function pages(entries: Record<string, unknown>[], perPage = 2) {
  return async (cursor: number) => ({ entries: entries.slice(cursor, cursor + perPage),
    next: cursor + perPage < entries.length ? cursor + perPage : null });
}
const entry = (path: string, data: Buffer, offset = 0, size = data.length, type = 'file') =>
  ({ path, type, mode: 0o644, size, offset, data: data.toString('base64') });

const putFrames = (transfer: string, target: 'workspace', files: TransferFile[]) => {
  const writer = putWriter(transfer, target);
  return [...files.flatMap(f => [...writer.add(f)]), ...writer.end()];
};

describe('supervisor transfer', () => {
  it('should bound dependency trees at 65536 files, 64 MiB per file and 1 GiB in total (decision 07/11 a)', () => {
    expect(TREE_LIMITS).toEqual({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 });
  });
  it('should emit each put frame as soon as it fills, holding one file and one frame', () => {
    const writer = putWriter('t1', 'dependencies');
    expect([...writer.add(file('big.bin', CHUNK_BYTES * 2 + 5))].map(f => f.entries.length)).toEqual([1, 1]);
    expect([...writer.add(file('small.js', 3))]).toEqual([]);
    expect([...writer.end()].map(f => f.entries.map(e => e.path))).toEqual([['big.bin', 'small.js']]);
    expect([...writer.end()]).toEqual([]);
  });
  it('should hand each finished snapshot file to the sink before reading the next page', async () => {
    const events: string[] = [];
    const list = [entry('a.js', Buffer.alloc(4, 1), 0, 6), entry('a.js', Buffer.alloc(2, 1), 4, 6), entry('b.js', Buffer.from('b'))];
    const page = pages(list, 1);
    await streamSnapshot(async cursor => { events.push(`page ${cursor}`); return page(cursor); }, TREE_LIMITS, 'refuse', fail,
      async f => { events.push(`file ${f.path} ${f.bytes.length}`); });
    expect(events).toEqual(['page 0', 'page 1', 'file a.js 6', 'page 2', 'file b.js 1']);
  });
  it('should split files into put frames that fit the signed frame bound and reassemble exactly', () => {
    const files = [file('a.txt', 0), file('big.bin', CHUNK_BYTES * 2 + 5), file('ui/x.js', 3)];
    const frames = putFrames('t1', 'workspace', files);
    for (const args of frames) expect(Buffer.byteLength(JSON.stringify(args)) + 512).toBeLessThan(MAX_FRAME_BYTES);
    const slices = frames.flatMap(args => args.entries as { path: string; offset: number; size: number; data: string }[]);
    expect(slices.filter(s => s.path === 'big.bin').map(s => s.offset)).toEqual([0, CHUNK_BYTES, CHUNK_BYTES * 2]);
    expect(slices.find(s => s.path === 'a.txt')).toMatchObject({ offset: 0, size: 0, data: '' });
    expect(frames.every(args => args.transfer === 't1' && args.target === 'workspace')).toBe(true);
  });
  it('should give an order-independent tree digest and refuse unsafe trees', () => {
    const a = [file('b', 1), file('a/c', 2, 0o755)];
    expect(treeDigest(a, OUTPUT_LIMITS, fail)).toBe(treeDigest([...a].reverse(), OUTPUT_LIMITS, fail));
    expect(treeDigest(a, OUTPUT_LIMITS, fail)).not.toBe(treeDigest([file('b', 1), file('a/c', 2)], OUTPUT_LIMITS, fail));
    for (const bad of [[file('../x', 1)], [file('/abs', 1)], [file('a', 1), file('a', 1)], [file('a', 1), file('a/b', 1)],
      [file('x', 1, 0o777)], [file('a\\b', 1)]]) expect(() => treeDigest(bad, OUTPUT_LIMITS, fail)).toThrow('invalid');
    expect(() => treeDigest([file('x', OUTPUT_LIMITS.fileBytes + 1)], OUTPUT_LIMITS, fail)).toThrow('limit');
  });
  it('should reassemble a paged stable output snapshot in order', async () => {
    const big = Buffer.alloc(10, 1);
    const files = await readSnapshot(pages([entry('index.html', Buffer.from('<p>')), entry('a.js', big.subarray(0, 4), 0, 10),
      entry('a.js', big.subarray(4), 4, 10)]), OUTPUT_LIMITS, 'refuse', fail);
    expect(files.map(f => [f.path, f.bytes.length])).toEqual([['index.html', 3], ['a.js', 10]]);
  });
  it('should refuse links, special files, escapes, duplicates, gaps and limit overflow before any upload', async () => {
    const one = Buffer.from('x');
    const invalid = [[entry('l', one, 0, 1, 'symlink')], [entry('d', one, 0, 1, 'other')], [entry('../e', one)],
      [entry('a', one), entry('a', one)], [entry('a', one, 1, 2)], [entry('a', one, 0, 2)], [{ path: 'a' }]];
    for (const list of invalid) await expect(readSnapshot(pages(list), OUTPUT_LIMITS, 'refuse', fail)).rejects.toThrow('invalid');
    const many = Array.from({ length: 256 }, (_, i) => entry(`f${i}`, one));
    await expect(readSnapshot(pages(many, 64), OUTPUT_LIMITS, 'refuse', fail)).rejects.toThrow('limit');
    await expect(readSnapshot(pages([entry('h', one, 0, OUTPUT_LIMITS.fileBytes + 1)]), OUTPUT_LIMITS, 'refuse', fail)).rejects.toThrow('limit');
    await expect(readSnapshot(async () => ({ entries: [], next: 0 }), OUTPUT_LIMITS, 'refuse', fail)).rejects.toThrow('invalid');
  });
  it('should skip dependency links only when asked, never other special files', async () => {
    const one = Buffer.from('x');
    const files = await readSnapshot(pages([entry('node_modules/.bin/vite', one, 0, 1, 'symlink'), entry('node_modules/v/i.js', one)]),
      OUTPUT_LIMITS, 'skip', fail);
    expect(files.map(f => f.path)).toEqual(['node_modules/v/i.js']);
    await expect(readSnapshot(pages([entry('fifo', one, 0, 1, 'other')]), OUTPUT_LIMITS, 'skip', fail)).rejects.toThrow('invalid');
  });
});
