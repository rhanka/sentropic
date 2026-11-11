import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSupervisorChannel, PIPELINE_WINDOW } from '../../../src/services/artifacts/live/supervisor-channel';
import { CHUNK_BYTES, extractTarZst, tarZst, TREE_LIMITS, ustarHeader,
  type TransferFailure, type TransferFile, type UstarMember } from '../../../src/services/artifacts/live/supervisor-transfer';
import { LiveError, type LiveRuntime } from '../../../src/services/artifacts/live/records';

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
});

describe('pipelined put frames', () => {
  const pair = generateKeyPairSync('ed25519');
  const runtime = { generation: 1, sessionId: 's', leaseEpoch: 1, routeEpoch: 1, podName: 'p', podUid: 'u' } as LiveRuntime;
  const treeFile = (path: string, size: number): TransferFile => ({ path, mode: 0o644, bytes: Buffer.alloc(size, 7) });
  /** Fake relay: decodes the sealed frame id and answers `{ok: true}`, with per-frame delays and failures. */
  function relay(options: { delay?: (index: number) => number; failAt?: number; calls?: string[] } = {}) {
    let index = 0; let inFlight = 0; let peak = 0;
    const channel = {
      send: vi.fn(async (_target: unknown, frame: Uint8Array) => {
        const at = index++;
        options.calls?.push(`put-${at}`);
        inFlight++; peak = Math.max(peak, inFlight);
        try {
          const wait = options.delay?.(at) ?? 0;
          if (wait) await new Promise(resolve => setTimeout(resolve, wait));
          if (options.failAt === at) throw new LiveError('limit_exceeded');
          const body = JSON.parse(Buffer.from(frame.subarray(64)).toString('utf8')) as { id: string };
          return Buffer.from(JSON.stringify({ id: body.id, ok: true, data: {} }));
        } finally { inFlight--; }
      }),
    };
    const core = createSupervisorChannel({ channel: channel as never, signingKey: () => pair.privateKey,
      now: () => 1_000, id: (() => { let n = 0; return () => `t-${++n}`; })() });
    return { channel, core, peak: () => peak };
  }
  it('should match the serial digest with at most 8 frames in flight under reordering', async () => {
    const files = Array.from({ length: 11 }, (_, i) => treeFile(`f${i}.bin`, CHUNK_BYTES + i));
    // Staggered 5–40 ms completions: every send queues in microtasks, so all 8 window slots fill before
    // the first ACK lands, and ACKs arrive out of send order.
    const reordered = relay({ delay: index => (((PIPELINE_WINDOW - (index % PIPELINE_WINDOW)) % PIPELINE_WINDOW) * 5) + 5 });
    const pipelined = await reordered.core.streamPipelined(runtime, 'install', files, TREE_LIMITS, fail);
    const serial = relay();
    const expected = await serial.core.stream(runtime, 'install', files, TREE_LIMITS, fail);
    expect(pipelined.treeDigest).toBe(expected.treeDigest);
    expect(reordered.channel.send).toHaveBeenCalledTimes(serial.channel.send.mock.calls.length);
    expect(reordered.peak()).toBeLessThanOrEqual(PIPELINE_WINDOW);
    expect(reordered.peak()).toBe(PIPELINE_WINDOW);
  });
  it('should fail the transfer on a refused frame and stop within one window', async () => {
    const files = Array.from({ length: 4 }, (_, i) => treeFile(`f${i}.bin`, CHUNK_BYTES * 3 + i));
    const calls: string[] = [];
    const failing = relay({ failAt: 0, calls });
    await expect(failing.core.streamPipelined(runtime, 'install', files, TREE_LIMITS, fail))
      .rejects.toMatchObject({ code: 'limit_exceeded' });
    // The first refusal is observed on microtasks, so at most the in-flight window plus one queued frame
    // goes out; the remaining ~dozen frames are never sent.
    expect(calls.length).toBeLessThanOrEqual(PIPELINE_WINDOW + 1);
  });
});

describe('sealed-unit tar.zst corruption', () => {
  it('should refuse a corrupted checksum or trailing garbage', async () => {
    const archive = await collect(streamOf([member('node_modules/a.js', 'x')]));
    const tampered = Buffer.from(archive); tampered[tampered.length - 1] ^= 0xff;
    await expect((async () => {
      for await (const _ of extractTarZst(tampered, tampered.byteLength, TREE_LIMITS, fail)) { /* drain */ }
    })()).rejects.toThrow();
  });
});
