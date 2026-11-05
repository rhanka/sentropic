/**
 * Upload integrity, fail-closed (immo preprod, @sentropic/artifacts 0.2.15).
 *
 * The presigned PUT announced `x-amz-checksum-sha256` but never signed it, so
 * OVH S3 refused the PUT (403, header present but not signed); without the
 * header the PUT returned 200 with no S3-side integrity check. commit_upload
 * must therefore prove the stored bytes itself, fail-closed: on any
 * size/digest mismatch it refuses with a typed error, deletes the staged
 * object, closes the session, and creates no release, blob or pin.
 *
 * Contract under test: create_upload announces exactly the signed header set
 * (`content-type` + `content-length`, no `x-amz-*`, no `checksumHeader`
 * field); the client PUTs exactly those headers; commit re-reads the staged
 * bytes and re-verifies size, SHA-256 digest and MIME before pinning.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  casBlobKey,
  commitStagedUpload,
  createMemoryStaging,
  createMemoryUploadSessionStore,
  createMemoryUploadSigner,
  createUploadService,
  stagingKey,
} from '../src/server/uploads.js';
import { createMemoryBlobStore } from '../src/server/publication.js';
import { createMemoryRefcountStore } from '../src/server/gc.js';

const sha = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const png = (fill: number): Uint8Array => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill,
]);

const base = { artifactId: '11111111-1111-1111-1111-111111111111', storageScopeId: 'scope-1', ownerId: 'alice' };

function makeWorld() {
  const sessions = createMemoryUploadSessionStore();
  const staging = createMemoryStaging();
  const uploadSigner = createMemoryUploadSigner();
  const blobs = createMemoryBlobStore();
  const refs = createMemoryRefcountStore();
  const service = createUploadService({ sessions, staging, signer: uploadSigner.signer }, {
    maxUploadBytes: 1024, maxSessionsPerPrincipal: 8,
  });
  const deps = { sessions, staging, blobs, refs, budget: { filesMax: 8, totalBytesMax: 8192 } };
  return { sessions, staging, uploadSigner, blobs, refs, service, deps };
}

describe('upload commit integrity (fail-closed)', () => {
  it('refuses a corrupted upload at commit: typed error, staging deleted, no release', async () => {
    const { sessions, staging, uploadSigner, blobs, refs, service, deps } = makeWorld();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    const bytes = png(3);
    uploadSigner.put(uploadSigner.signed.at(-1)!, bytes, { ...created.requiredHeaders });
    await staging.put(created.stagingKey, bytes);

    const corruptDigest = sha(png(4));
    const failure = await commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: corruptDigest, size: 12,
    }).then(() => null, (error: unknown) => error as { name?: string; reason?: string; message?: string });
    expect(failure).not.toBeNull();
    expect(String(failure?.message ?? failure)).toMatch(/digest mismatch/);
    // Typed refusal: the error carries a machine-readable reason.
    expect(failure?.name).toBe('UploadVerificationError');
    expect(failure?.reason).toBe('digest_mismatch');
    // Fail-closed: the staged object is deleted, the session is closed, and
    // nothing was pinned or stored under either the declared or actual digest.
    expect(await staging.get(created.stagingKey)).toBeUndefined();
    expect((await sessions.get(created.uploadId))!.state).toBe('expired');
    expect(await blobs.getBlob(casBlobKey(base.storageScopeId, corruptDigest))).toBeUndefined();
    expect(await blobs.getBlob(casBlobKey(base.storageScopeId, sha(bytes)))).toBeUndefined();
    expect(await refs.isPinned(corruptDigest)).toBe(false);
    expect(await refs.isPinned(sha(bytes))).toBe(false);
    // The poisoned session cannot be retried: a correct declaration afterwards
    // is refused instead of committing.
    await expect(commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: sha(bytes), size: 12,
    })).rejects.toThrow();
    expect(await blobs.listKeys(`artifacts/${base.storageScopeId}/blobs/`)).toEqual([]);
  });

  it('refuses a size mismatch at commit and deletes the staged object', async () => {
    const { staging, uploadSigner, blobs, service, deps } = makeWorld();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    const bytes = png(5);
    uploadSigner.put(uploadSigner.signed.at(-1)!, bytes, { ...created.requiredHeaders });
    await staging.put(created.stagingKey, bytes);

    const failure = await commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: sha(bytes), size: 11,
    }).then(() => null, (error: unknown) => error as { name?: string; reason?: string });
    expect(failure?.name).toBe('UploadVerificationError');
    expect(failure?.reason).toBe('size_mismatch');
    expect(await staging.get(created.stagingKey)).toBeUndefined();
    expect(await blobs.listKeys(`artifacts/${base.storageScopeId}/blobs/`)).toEqual([]);
  });

  it('commits a correct upload sent with exactly the announced headers', async () => {
    const { staging, uploadSigner, blobs, refs, service, deps } = makeWorld();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    // No checksum header is announced anymore: the announced set is the whole contract.
    expect('checksumHeader' in created).toBe(false);
    const bytes = png(6);
    uploadSigner.put(uploadSigner.signed.at(-1)!, bytes, { ...created.requiredHeaders });
    await staging.put(created.stagingKey, bytes);

    const staged = await commitStagedUpload(service, deps, {
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png',
      digest: sha(bytes), size: 12,
    });
    expect(staged).toMatchObject({ uploadId: created.uploadId, digest: sha(bytes), size: 12 });
    expect(await blobs.getBlob(casBlobKey(base.storageScopeId, sha(bytes)))).toEqual(bytes);
    expect(await refs.isPinned(sha(bytes))).toBe(true);
    // Staging is cleaned after a successful promotion.
    expect(await staging.get(created.stagingKey)).toBeUndefined();
  });

  it('announces exactly the signed header set (no unsigned x-amz-* header)', async () => {
    const { uploadSigner, service } = makeWorld();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    expect(Object.keys(created.requiredHeaders).sort()).toEqual(['content-length', 'content-type']);
    expect(Object.keys(created.requiredHeaders).some((key) => key.startsWith('x-amz-'))).toBe(false);
    expect('checksumHeader' in created).toBe(false);
    // The test double encodes the OVH strictness: any x-amz-* header that is
    // not part of the signed set is rejected, like OVH S3 rejects a presigned
    // PUT carrying an unsigned x-amz-checksum-sha256 (403 AccessDenied).
    const signed = uploadSigner.signed.at(-1)!;
    const bytes = png(7);
    expect(() => uploadSigner.put(signed, bytes,
      { ...created.requiredHeaders, 'x-amz-checksum-sha256': 'unsigned' })).toThrow(/not signed/);
    expect(() => uploadSigner.put(signed, bytes, { ...created.requiredHeaders })).not.toThrow();
  });
});
