import { describe, expect, it } from 'vitest';
import { extractTarZst, tarZst, TREE_LIMITS, ustarHeader, type TransferFailure, type UstarMember } from '../../../src/services/artifacts/live/supervisor-transfer';
import { LiveError } from '../../../src/services/artifacts/live/records';

const fail: TransferFailure = kind => {
  if (kind === 'limit') throw new LiveError('limit_exceeded');
  throw new LiveError('dependency_cache_invalid');
};
const member = (path: string, value: string, mode: 292 | 365 = 292): UstarMember =>
  ({ path, mode, bytes: Buffer.from(value) });
async function collect(members: AsyncIterable<UstarMember>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of tarZst(members)) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function* streamOf(members: UstarMember[]): AsyncGenerator<UstarMember> {
  for (const member of members) yield member;
}

describe('sealed-unit tar.zst unit', () => {
  it('should round-trip members through one deterministic archive', async () => {
    const members = [member('node_modules/a/index.js', 'a'.repeat(1000)), member('node_modules/b/package.json', '{}', 365)];
    const first = await collect(streamOf(members));
    const second = await collect(streamOf([...members].reverse()));
    expect(first.equals(second)).toBe(false); // order matters: callers feed sorted walks
    const sorted = [...members].sort((a, b) => (a.path < b.path ? -1 : 1));
    expect(await collect(streamOf(sorted))).toEqual(await collect(streamOf(sorted)));
    const out: UstarMember[] = [];
    for await (const file of extractTarZst(first, first.byteLength, TREE_LIMITS, fail)) out.push(file);
    expect(out.map(f => [f.path, f.mode, Buffer.from(f.bytes).toString()])).toEqual([
      ['node_modules/a/index.js', 292, 'a'.repeat(1000)], ['node_modules/b/package.json', 365, '{}']]);
  });
  it('should refuse links, absolute paths, traversals, devices and bad modes', async () => {
    for (const path of ['/absolute', '../escape', 'a/../../b', 'node_modules/.git/x']) {
      expect(() => ustarHeader({ path, mode: 292, size: 1 }, fail)).toThrow();
    }
    expect(() => ustarHeader({ path: 'a', mode: 511 as never, size: 1 }, fail)).toThrow();
    // A hand-built ustar with a symlink typeflag refuses on extraction.
    const header = Buffer.from(ustarHeader({ path: 'node_modules/link', mode: 292, size: 0 }, fail));
    header[156] = 0x32; // '2'
    const zlib = (await import('node:zlib')) as unknown as {
      createZstdCompress(): NodeJS.ReadWriteStream;
    };
    const { Readable } = await import('node:stream');
    const archive: Uint8Array[] = [];
    for await (const chunk of Readable.from([header, Buffer.alloc(512, 0)]).pipe(zlib.createZstdCompress())) {
      archive.push(chunk as Uint8Array);
    }
    const bytes = Buffer.concat(archive);
    await expect((async () => {
      for await (const _ of extractTarZst(bytes, bytes.byteLength, TREE_LIMITS, fail)) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'dependency_cache_invalid' });
  });
  it('should refuse ratio bombs and over-limit trees while streaming', async () => {
    // 1 MiB of zeros compresses tiny: extracting past 20x the archive size refuses.
    const big = await collect(streamOf([member('node_modules/big.bin', '0'.repeat(1024 * 1024))]));
    const tiny: TransferFailure = kind => { throw new LiveError(kind === 'limit' ? 'limit_exceeded' : 'x'); };
    await expect((async () => {
      for await (const _ of extractTarZst(big, 1, TREE_LIMITS, tiny)) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'limit_exceeded' });
    await expect((async () => {
      for await (const _ of extractTarZst(big, big.byteLength, { ...TREE_LIMITS, fileBytes: 10 }, fail)) { /* drain */ }
    })()).rejects.toMatchObject({ code: 'limit_exceeded' });
  });
  it('should refuse a corrupted checksum or trailing garbage', async () => {
    const archive = await collect(streamOf([member('node_modules/a.js', 'x')]));
    const tampered = Buffer.from(archive); tampered[tampered.length - 1] ^= 0xff;
    await expect((async () => {
      for await (const _ of extractTarZst(tampered, tampered.byteLength, TREE_LIMITS, fail)) { /* drain */ }
    })()).rejects.toThrow();
  });
});
