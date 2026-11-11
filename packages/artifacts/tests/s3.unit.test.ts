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
