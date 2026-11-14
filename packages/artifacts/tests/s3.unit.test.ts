/**
 * CMF-S1 — S3 create-only unit proof (mocked client, no network).
 * Verifies `If-None-Match: '*'` is sent, `PreconditionFailed` settles by
 * verified read-back (identical idempotent), and successful puts read back
 * verified bytes.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createS3BlobStore } from '../src/adapters/s3.js';

function keyFor(bytes: Uint8Array, scope = 'scope-a'): string {
  return `artifacts/${scope}/blobs/sha256/${createHash('sha256').update(bytes).digest('hex')}`;
}

const BYTES = new TextEncoder().encode('s3 unit fixture bytes');
const KEY = keyFor(BYTES);

describe('s3 create-only puts', () => {
  it('sends IfNoneMatch and settles PreconditionFailed by verified read-back', async () => {
    const stored = new Map<string, Uint8Array>();
    const puts: unknown[] = [];
    const send = vi.fn(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
      const name = command.constructor.name;
      if (name === 'PutObjectCommand') {
        puts.push(command.input);
        const key = command.input?.Key as string;
        if (stored.has(key)) {
          const error = new Error('precondition');
          (error as { name: string }).name = 'PreconditionFailed';
          throw error;
        }
        stored.set(key, new Uint8Array(command.input?.Body as Uint8Array));
        return {};
      }
      if (name === 'GetObjectCommand') {
        const key = command.input?.Key as string;
        const bytes = stored.get(key);
        if (bytes === undefined) {
          const error = new Error('missing');
          (error as { name: string }).name = 'NoSuchKey';
          throw error;
        }
        return { Body: { transformToByteArray: async () => new Uint8Array(bytes) } };
      }
      throw new Error(`unexpected command ${name}`);
    });
    const blobs = createS3BlobStore({ client: { send } as never, bucket: 'unit' });
    await blobs.putBlob(KEY, BYTES);
    expect(puts[0]).toMatchObject({ Bucket: 'unit', Key: KEY, IfNoneMatch: '*' });
    // Identical retry settles through PreconditionFailed without overwrite.
    await blobs.putBlob(KEY, BYTES);
    expect(puts).toHaveLength(2);
    expect(puts[1]).toMatchObject({ IfNoneMatch: '*' });
    expect(await blobs.getBlob(KEY)).toEqual(new Uint8Array(BYTES));
  });

  it('pages with StartAfter and MaxKeys without loading the whole prefix', async () => {
    const prefix = 'artifacts/scope-a/blobs/sha256/';
    const all = [0, 1, 2, 3, 4].map((index) => `${prefix}${String(index).repeat(64).slice(0, 64)}`).sort();
    const seen: Array<{ startAfter: unknown; maxKeys: unknown }> = [];
    const send = vi.fn(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
      if (command.constructor.name !== 'ListObjectsV2Command') throw new Error(`unexpected command ${command.constructor.name}`);
      const input = command.input ?? {};
      seen.push({ startAfter: input.StartAfter, maxKeys: input.MaxKeys });
      const keys = all.filter((key) => key.startsWith(input.Prefix as string) && (input.StartAfter === undefined || key > (input.StartAfter as string)));
      const maxKeys = input.MaxKeys as number;
      const page = keys.slice(0, maxKeys);
      return { Contents: page.map((Key) => ({ Key })), IsTruncated: keys.length > maxKeys };
    });
    const blobs = createS3BlobStore({ client: { send } as never, bucket: 'unit' });
    expect(blobs.listKeysPaged).toBeDefined();
    const walked: string[] = [];
    let startAfter: string | undefined;
    for (;;) {
      const result = await blobs.listKeysPaged!(prefix, startAfter === undefined
        ? { maxItems: 2, maxEncodedBytes: 1_000_000 }
        : { maxItems: 2, maxEncodedBytes: 1_000_000, startAfter });
      expect(result.keys.length).toBeLessThanOrEqual(2);
      walked.push(...result.keys);
      if (!result.hasMore) break;
      startAfter = result.keys[result.keys.length - 1];
    }
    expect(walked).toEqual(all);
    for (const selected of [all[4]!, all[4]!.slice(0, -60)]) {
      expect(await blobs.listKeysPaged!(selected, { maxItems: 1, maxEncodedBytes: 1000 }))
        .toEqual({ keys: [all[4]], hasMore: false });
    }
    expect(seen[0]).toMatchObject({ startAfter: undefined, maxKeys: 3 });
    expect(seen[1]).toMatchObject({ startAfter: all[1], maxKeys: 3 });
    await expect(blobs.listKeysPaged!(prefix, {
      maxItems: 2, maxEncodedBytes: 1_000_000, startAfter: 'artifacts/other/blobs/sha256/' + 'f'.repeat(64),
    })).rejects.toThrow(/resume key/);
  });

  it('fails closed when stored bytes do not verify', async () => {
    const send = vi.fn(async (command: { constructor: { name: string }; input?: Record<string, unknown> }) => {
      const name = command.constructor.name;
      if (name === 'PutObjectCommand') {
        const error = new Error('precondition');
        (error as { name: string }).name = 'PreconditionFailed';
        throw error;
      }
      if (name === 'GetObjectCommand') {
        return { Body: { transformToByteArray: async () => new TextEncoder().encode('corrupt') } };
      }
      throw new Error(`unexpected command ${name}`);
    });
    const blobs = createS3BlobStore({ client: { send } as never, bucket: 'unit' });
    await expect(blobs.putBlob(KEY, BYTES)).rejects.toThrow(/digest mismatch/);
  });
});
