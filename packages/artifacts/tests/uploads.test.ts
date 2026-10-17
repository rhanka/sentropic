/**
 * L-5b — bounded uploads: staged bytes, verified commit.
 *
 * Uploads stage bytes under a bounded prefix with a strict size budget and
 * sequential offsets. Commit verifies final bytes against the declared
 * digest and size before returning a blob reference; false hashes/sizes,
 * over-budget appends, out-of-order offsets and any write after commit are
 * refused fail-closed. Staging is ephemeral (crash reprise belongs to
 * publication intents in crash-recovery.test.ts).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createUploadService, createMemoryStaging } from '../src/server/uploads.js';

function sha(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function owe(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

describe('bounded uploads', () => {
  it('stages sequential chunks and commits a verified blob ref', async () => {
    const uploads = createUploadService(createMemoryStaging(), { maxUploadBytes: 16 });
    const { uploadId } = await uploads.begin({ mimeType: 'text/html' });
    await uploads.append(uploadId, 0, owe([1, 2, 3]));
    await uploads.append(uploadId, 3, owe([4, 5]));
    const bytes = owe([1, 2, 3, 4, 5]);
    const ref = await uploads.commit(uploadId, { digest: sha(bytes), size: 5 });
    expect(ref).toEqual({ digest: sha(bytes), size: 5 });
  });

  it('refuses out-of-order offsets and writes after commit', async () => {
    const uploads = createUploadService(createMemoryStaging(), { maxUploadBytes: 16 });
    const { uploadId } = await uploads.begin({ mimeType: 'text/html' });
    await expect(uploads.append(uploadId, 2, owe([9]))).rejects.toThrow(/offset/);
    await uploads.append(uploadId, 0, owe([1]));
    const ref = await uploads.commit(uploadId, { digest: sha(owe([1])), size: 1 });
    expect(ref.size).toBe(1);
    await expect(uploads.append(uploadId, 1, owe([2]))).rejects.toThrow(/committed/);
    await expect(
      uploads.commit(uploadId, { digest: sha(owe([1])), size: 1 }),
    ).rejects.toThrow(/committed/);
  });

  it('enforces the size budget', async () => {
    const uploads = createUploadService(createMemoryStaging(), { maxUploadBytes: 4 });
    const { uploadId } = await uploads.begin({ mimeType: 'text/html' });
    await uploads.append(uploadId, 0, owe([1, 2]));
    await expect(uploads.append(uploadId, 2, owe([3, 4, 5]))).rejects.toThrow(/budget/);
    const small = await uploads.begin({ mimeType: 'text/html', maxSize: 1 });
    await expect(uploads.append(small.uploadId, 0, owe([1, 2]))).rejects.toThrow(/budget/);
  });

  it('refuses false hashes and sizes at commit', async () => {
    const uploads = createUploadService(createMemoryStaging(), { maxUploadBytes: 16 });
    const { uploadId } = await uploads.begin({ mimeType: 'text/html' });
    await uploads.append(uploadId, 0, owe([1, 2, 3]));
    await expect(uploads.commit(uploadId, { digest: sha(owe([9])), size: 3 })).rejects.toThrow(
      /digest/,
    );
    await expect(uploads.commit(uploadId, { digest: sha(owe([1, 2, 3])), size: 9 })).rejects.toThrow(
      /size/,
    );
  });

  it('keeps sessions isolated and rejects unknown uploads', async () => {
    const uploads = createUploadService(createMemoryStaging(), { maxUploadBytes: 16 });
    const a = await uploads.begin({ mimeType: 'text/html' });
    const b = await uploads.begin({ mimeType: 'text/html' });
    await uploads.append(a.uploadId, 0, owe([1]));
    await uploads.append(b.uploadId, 0, owe([2, 3]));
    const refA = await uploads.commit(a.uploadId, { digest: sha(owe([1])), size: 1 });
    expect(refA.size).toBe(1);
    await expect(uploads.append('nope', 0, owe([1]))).rejects.toThrow(/unknown upload/);
    await expect(uploads.commit('nope', { digest: sha(owe([1])), size: 1 })).rejects.toThrow(
      /unknown upload/,
    );
  });
});
