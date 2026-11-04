/**
 * Files parity LOT 1 — upload sessions with a presigned signed PUT.
 *
 * create_upload mints a session + a signed PUT (exact Content-Length bound in
 * the signature, review finding 3); the client PUTs bytes straight to
 * "S3" (the memory signer enforces the signed headers and the checksum);
 * commit re-reads the staged object once and verifies declared size, SHA-256
 * digest and MIME (magic bytes / strict UTF-8 / SVG) before anything is
 * pinned. The enforced sweeper expires stale open sessions and deletes their
 * staging objects (gc.ts, migration 0007 expires_at).
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  checksumHeaderValue, createMemoryStaging, createMemoryUploadSessionStore,
  createMemoryUploadSigner, createUploadService, stagingKey, UPLOAD_SESSION_TTL_MS,
} from '../src/server/uploads.js';
import { createUploadSweeper } from '../src/server/gc.js';
import { validateFileBytes } from '../src/server/mime.js';

const sha = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const png = (fill: number): Uint8Array => Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, fill, fill, fill, fill,
]);

function makeService(options: { maxUploadBytes?: number; maxSessionsPerPrincipal?: number; now?: () => Date } = {}) {
  const sessions = createMemoryUploadSessionStore(options.now);
  const staging = createMemoryStaging();
  const signer = createMemoryUploadSigner();
  const service = createUploadService({ sessions, staging, signer: signer.signer }, {
    maxUploadBytes: options.maxUploadBytes ?? 1024,
    maxSessionsPerPrincipal: options.maxSessionsPerPrincipal ?? 2,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  return { sessions, staging, signer, service };
}

const base = { artifactId: '11111111-1111-1111-1111-111111111111', storageScopeId: 'scope-1', ownerId: 'alice' };

describe('upload sessions (files parity LOT 1)', () => {
  it('creates a session with a signed PUT binding content-type and the exact content-length', async () => {
    const { service, signer } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 4096 });
    expect(created.method).toBe('PUT');
    expect(created.maxSize).toBe(1024); // clamped to the host budget
    expect(created.requiredHeaders['content-type']).toBe('image/png');
    expect(created.requiredHeaders['content-length']).toBe('1024');
    expect(created.checksumHeader).toBe('x-amz-checksum-sha256');
    expect(created.stagingKey).toBe(stagingKey('scope-1', created.uploadId));
    expect(signer.signed).toHaveLength(1);
    expect(signer.signed[0]).toMatchObject({ contentType: 'image/png', contentLength: 1024 });
    const session = await service.sessionForCommit({
      uploadId: created.uploadId, ...base, path: 'shots/a.png', mimeType: 'image/png',
      digest: sha(png(1)), size: 12,
    });
    expect(session.state).toBe('open');
  });

  it('enforces the open-session quota per principal and scope', async () => {
    const { service } = makeService({ maxSessionsPerPrincipal: 2 });
    await service.create({ ...base, mimeType: 'image/png' });
    await service.create({ ...base, mimeType: 'image/png' });
    await expect(service.create({ ...base, mimeType: 'image/png' })).rejects.toThrow(/quota/);
    // Another principal or scope is unaffected.
    await service.create({ ...base, ownerId: 'bob', mimeType: 'image/png' });
    await service.create({ ...base, storageScopeId: 'scope-2', mimeType: 'image/png' });
  });

  it('simulated PUT enforces the signed content-length and the checksum header', async () => {
    const { service, staging, signer } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    const bytes = png(7);
    // Wrong body size vs the signed exact content-length: refused.
    expect(() => signer.put(signer.signed[0], png(8).subarray(0, 8), { ...created.requiredHeaders, 'content-length': '12' }))
      .toThrow(/content-length mismatch/);
    // Right size but wrong checksum header: BadDigest.
    expect(() => signer.put(signer.signed[0], bytes, {
      ...created.requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha(png(9))),
    })).toThrow(/BadDigest/);
    // Correct PUT lands in staging.
    signer.put(signer.signed[0], bytes, {
      ...created.requiredHeaders, 'x-amz-checksum-sha256': checksumHeaderValue(sha(bytes)),
    });
    await staging.put(created.stagingKey, bytes);
    expect(await staging.get(created.stagingKey)).toEqual(bytes);
  });

  it('commit refuses a wrong size or digest and a foreign binding', async () => {
    const { service, staging } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    const bytes = png(3);
    await staging.put(created.stagingKey, bytes);
    const session = await service.sessionForCommit({
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png', digest: sha(bytes), size: 12,
    });
    expect(() => service.verifyStaged(session, bytes, { digest: sha(png(4)), size: 12, mimeType: 'image/png' }))
      .toThrow(/digest mismatch/);
    expect(() => service.verifyStaged(session, bytes, { digest: sha(bytes), size: 11, mimeType: 'image/png' }))
      .toThrow(/size mismatch/);
    expect(() => service.verifyStaged(session, bytes, { digest: sha(bytes), size: 12, mimeType: 'text/html' }))
      .toThrow(/MIME mismatch/);
    // Foreign artifact/owner/scope cannot commit this session.
    await expect(service.sessionForCommit({
      uploadId: created.uploadId, ...base, artifactId: '22222222-2222-2222-2222-222222222222',
      path: 'a.png', mimeType: 'image/png', digest: sha(bytes), size: 12,
    })).rejects.toThrow(/unknown upload/);
    await expect(service.sessionForCommit({
      uploadId: created.uploadId, ...base, ownerId: 'mallory',
      path: 'a.png', mimeType: 'image/png', digest: sha(bytes), size: 12,
    })).rejects.toThrow(/unknown upload/);
    // Correct verification passes and completeCommit records + closes.
    service.verifyStaged(session, bytes, { digest: sha(bytes), size: 12, mimeType: 'image/png' });
    const staged = await service.completeCommit(session, { path: 'a.png', mimeType: 'image/png', digest: sha(bytes), size: 12 });
    expect(staged).toMatchObject({ uploadId: created.uploadId, path: 'a.png', digest: sha(bytes), size: 12 });
    expect((await service.sessionForCommit({
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png', digest: sha(bytes), size: 12,
    }).catch(() => null))).toBeNull(); // now committed -> not open
  });

  it('refuses bytes whose magic bytes do not match the declared MIME', async () => {
    const { service, staging } = makeService();
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 64 });
    const text = new TextEncoder().encode('not a png at all');
    await staging.put(created.stagingKey, text);
    const session = await service.sessionForCommit({
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png', digest: sha(text), size: text.length,
    });
    expect(() => service.verifyStaged(session, text, { digest: sha(text), size: text.length, mimeType: 'image/png' }))
      .toThrow();
    expect(() => validateFileBytes('image/png', text)).toThrow();
  });

  it('expires stale open sessions through the enforced sweeper and deletes staging', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const { service, sessions, staging } = makeService({ now: () => now });
    const created = await service.create({ ...base, mimeType: 'image/png', maxSize: 12 });
    await staging.put(created.stagingKey, png(5));
    const sweeper = createUploadSweeper({ sessions, staging });
    // Not yet expired: nothing happens.
    expect(await sweeper.sweep(new Date('2026-01-01T00:00:00Z'))).toEqual({ expired: [], deletedKeys: [],
      failures: [], stagedExpired: [], unpinned: [], orphanKeys: [], pagesExpired: [] });
    // Past the session TTL: expired + staging deleted.
    now = new Date(now.getTime() + UPLOAD_SESSION_TTL_MS + 1000);
    const report = await sweeper.sweep(now);
    expect(report.expired).toEqual([created.uploadId]);
    expect(report.deletedKeys).toEqual([created.stagingKey]);
    expect(await staging.get(created.stagingKey)).toBeUndefined();
    expect((await sessions.get(created.uploadId))!.state).toBe('expired');
    // Committing an expired session is refused.
    await expect(service.sessionForCommit({
      uploadId: created.uploadId, ...base, path: 'a.png', mimeType: 'image/png', digest: sha(png(5)), size: 12,
    })).rejects.toThrow(/expired/);
  });
});
