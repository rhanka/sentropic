import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalManifest, manifestDigest } from '../src/codecs.js';
import { readArtifactSource } from '../src/server/source-read.js';
import { DEFAULT_API_GUIDE_VERSION } from '../src/server/templates.js';
import { createMemoryBlobStore, createMemoryStateStore, createPublicationService } from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { encodeToolResult } from '@sentropic/mcp-platform/transport/result-codec';

const artifactId = '00000000-0000-4000-8000-000000000001';
const releaseId = '00000000-0000-4000-8000-000000000002';
const bytes = Buffer.from('<p>author bytes</p>');
const digest = createHash('sha256').update(bytes).digest('hex');
function world() {
  const body = { schemaVersion: 'artifacts/v1', artifactId, files: [
    { path: 'index.html', mimeType: 'text/html', size: bytes.length, digest: `sha256:${digest}` },
  ] };
  const manifest = canonicalManifest({ ...body, digest: manifestDigest(body) });
  const release = { artifactId, releaseId, manifest, manifestDigest: manifestDigest(body),
    state: 'ready' as const, createdAt: '2026-11-01T00:00:00Z' };
  let allowed = true;
  const deps = { authorize: async () => { if (!allowed) throw new Error('source denied'); },
    getCurrent: async () => release, getRelease: async () => release,
    getSource: async () => ({ kind: 'recipe' as const, steps: ['never execute'] }),
    getBlob: async () => bytes, urls: () => ({ stableUrl: 'https://a.test/a', versionUrl: 'https://a.test/r' }),
    maxFiles: 32, maxTotalBytes: 262144 };
  return { deps, release, deny: () => { allowed = false; } };
}
describe('verified author source', () => {
  it.each([
    { label: 'purged release', change: { state: 'purged' as const }, error: 'release_unavailable', details: { reason: 'purged' } },
    { label: 'record digest mismatch', change: { manifestDigest: '0'.repeat(64) }, error: 'verification_failed', details: undefined },
  ])('should reject $label through the publication service before reading blobs', async ({ change, error, details }) => {
    const { deps, release } = world();
    const state = createMemoryStateStore();
    const publication = createPublicationService({ state, blobs: createMemoryBlobStore(), intents: createMemoryIntentStore() });
    await state.putRelease({ ...release, ...change });
    await state.compareAndSwapCurrent(artifactId, null, releaseId);
    let blobReads = 0;
    const ports = { ...deps, getCurrent: publication.getCurrent, getRelease: publication.getRelease,
      getBlob: async () => { blobReads += 1; return bytes; } };
    for (const input of [{ artifactId, releaseId }, { artifactId }]) {
      await expect(readArtifactSource(ports, input)).rejects.toMatchObject({ kind: error,
        details: details === undefined ? {} : { publicDetails: details } });
    }
    expect(blobReads).toBe(0);
  });
  it('should return text-encoded files and separate provenance for a selected release', async () => {
    const { deps } = world();
    const result = await readArtifactSource(deps, { artifactId, releaseId, paths: ['index.html'] });
    expect(result.files[0]).toMatchObject({ path: 'index.html', mimeType: 'text/html', size: bytes.length,
      digest: `sha256:${digest}`, text: '<p>author bytes</p>', encoding: 'utf8' });
    expect(result.files[0]).not.toHaveProperty('bytes');
    expect(result.sourceRef).toEqual({ kind: 'recipe', steps: ['never execute'] });
    expect(result.releaseId).toBe(releaseId);
  });
  it('should encode non-text files as base64, never as an integer array', async () => {
    const { deps, release } = world();
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0xff]);
    const binDigest = createHash('sha256').update(binary).digest('hex');
    const body = { schemaVersion: 'artifacts/v1', artifactId, files: [
      { path: 'logo.png', mimeType: 'image/png', size: binary.length, digest: `sha256:${binDigest}` },
    ] };
    const snapshot = { ...release, manifestDigest: manifestDigest(body),
      manifest: canonicalManifest({ ...body, digest: manifestDigest(body) }) };
    const output = await readArtifactSource({ ...deps, getCurrent: async () => snapshot,
      getBlob: async () => binary }, { artifactId });
    expect(output.files[0]).toMatchObject({ path: 'logo.png', mimeType: 'image/png', size: binary.length,
      digest: `sha256:${binDigest}`, encoding: 'base64', base64: binary.toString('base64') });
    expect(output.files[0]).not.toHaveProperty('bytes');
    expect(output.files[0]).not.toHaveProperty('text');
  });
  it('should fall back to base64 when a text mime is not valid UTF-8', async () => {
    const { deps, release } = world();
    const raw = Buffer.from([0xff, 0xfe, 0x41]);
    const rawDigest = createHash('sha256').update(raw).digest('hex');
    const body = { schemaVersion: 'artifacts/v1', artifactId, files: [
      { path: 'notes.txt', mimeType: 'text/plain', size: raw.length, digest: `sha256:${rawDigest}` },
    ] };
    const snapshot = { ...release, manifestDigest: manifestDigest(body),
      manifest: canonicalManifest({ ...body, digest: manifestDigest(body) }) };
    const output = await readArtifactSource({ ...deps, getCurrent: async () => snapshot,
      getBlob: async () => raw }, { artifactId });
    expect(output.files[0]).toMatchObject({ path: 'notes.txt', mimeType: 'text/plain',
      encoding: 'base64', base64: raw.toString('base64') });
    expect(output.files[0]).not.toHaveProperty('bytes');
    expect(output.files[0]).not.toHaveProperty('text');
  });
  it('should keep an 816-byte page result small and carry only a guide reference', async () => {
    const { deps, release } = world();
    const head = '<!doctype html><html><head><meta charset="utf-8"><title>816-byte page</title></head><body>';
    const tail = '</body></html>';
    const page = head + 'x'.repeat(816 - Buffer.byteLength(head + tail, 'utf8')) + tail;
    expect(Buffer.byteLength(page, 'utf8')).toBe(816);
    const pageBytes = Buffer.from(page, 'utf8');
    const pageDigest = createHash('sha256').update(pageBytes).digest('hex');
    const body = { schemaVersion: 'artifacts/v1', artifactId, files: [
      { path: 'index.html', mimeType: 'text/html', size: pageBytes.length, digest: `sha256:${pageDigest}` },
    ] };
    const snapshot = { ...release, manifestDigest: manifestDigest(body),
      manifest: canonicalManifest({ ...body, digest: manifestDigest(body) }) };
    const output = await readArtifactSource({ ...deps, getCurrent: async () => snapshot,
      getBlob: async () => pageBytes }, { artifactId });
    expect(output.files[0]).toMatchObject({ path: 'index.html', mimeType: 'text/html', size: 816,
      digest: `sha256:${pageDigest}`, text: page, encoding: 'utf8' });
    expect(output.files[0]).not.toHaveProperty('bytes');
    expect(output.guideRef).toEqual({ tool: 'artifacts_get_api_guide', version: DEFAULT_API_GUIDE_VERSION });
    const serialized = JSON.stringify(output);
    expect(serialized).not.toContain('Artifacts API guide');
    expect(Buffer.byteLength(serialized)).toBeLessThan(4096);
    const wire = encodeToolResult({ ok: true, output, auditId: 'budget-test', redactionClass: 'low' });
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(4096);
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toEqual(output);
  });
  it('should reject corrupt bytes, foreign releases and missing paths', async () => {
    const { deps, release } = world();
    await expect(readArtifactSource({ ...deps, getBlob: async () => Buffer.from('bad') }, { artifactId })).rejects.toThrow('verification_failed');
    await expect(readArtifactSource({ ...deps, getRelease: async () => ({ ...release, artifactId: releaseId }) }, { artifactId, releaseId })).rejects.toThrow('not_found');
    await expect(readArtifactSource(deps, { artifactId, paths: ['missing'] })).rejects.toThrow('invalid_request');
  });
  it('should reauthorize after asynchronous blob reads', async () => {
    const { deps, deny } = world();
    await expect(readArtifactSource({ ...deps, getBlob: async () => { deny(); return bytes; } }, { artifactId })).rejects.toThrow('source denied');
  });
  it('should return the full 32-file 256 KiB snapshot within the serialized budget', async () => {
    const { deps, release } = world();
    const content = Buffer.alloc(8192, 97); // 'a' repeated: valid UTF-8 text
    const fileDigest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const body = { schemaVersion: 'artifacts/v1', artifactId, files: Array.from({ length: 32 }, (_, index) => ({
      path: `${index}.js`, mimeType: 'text/javascript', size: content.length, digest: fileDigest })) };
    const snapshot = { ...release, manifestDigest: manifestDigest(body),
      manifest: canonicalManifest({ ...body, digest: manifestDigest(body) }) };
    const output = await readArtifactSource({ ...deps, getCurrent: async () => snapshot, getBlob: async () => content }, { artifactId });
    expect(output.files).toHaveLength(32);
    expect(output.files.every((file) => file.encoding === 'utf8' && typeof file.text === 'string' &&
      !Object.hasOwn(file, 'bytes'))).toBe(true);
    expect(output.files.reduce((total, file) => total + file.size, 0)).toBe(262144);
    expect(output.files.every((file) => Buffer.byteLength(file.text, 'utf8') === 8192)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(2097152);
    const wire = encodeToolResult({ ok: true, output, auditId: 'budget-test', redactionClass: 'low' });
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(2097152);
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toEqual(output);
    await expect(readArtifactSource(deps, { artifactId, paths: [] })).rejects.toThrow('invalid_request');
  });
});
