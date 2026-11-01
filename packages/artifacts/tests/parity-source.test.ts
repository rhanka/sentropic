import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalManifest, manifestDigest } from '../src/codecs.js';
import { readArtifactSource } from '../src/server/source-read.js';
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
    getBlob: async () => bytes, urls: () => ({ stableUrl: 'https://a.test/a', pinnedUrl: 'https://a.test/r' }),
    maxFiles: 32, maxTotalBytes: 262144 };
  return { deps, release, deny: () => { allowed = false; } };
}
describe('verified author source', () => {
  it('should return exact bytes and separate provenance for a selected release', async () => {
    const { deps } = world();
    const result = await readArtifactSource(deps, { artifactId, releaseId, paths: ['index.html'] });
    expect(result.files[0].bytes).toEqual([...bytes]);
    expect(result.sourceRef).toEqual({ kind: 'recipe', steps: ['never execute'] });
    expect(result.releaseId).toBe(releaseId);
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
    const content = Buffer.alloc(8192, 255);
    const fileDigest = `sha256:${createHash('sha256').update(content).digest('hex')}`;
    const body = { schemaVersion: 'artifacts/v1', artifactId, files: Array.from({ length: 32 }, (_, index) => ({
      path: `${index}.js`, mimeType: 'text/javascript', size: content.length, digest: fileDigest })) };
    const snapshot = { ...release, manifestDigest: manifestDigest(body),
      manifest: canonicalManifest({ ...body, digest: manifestDigest(body) }) };
    const output = await readArtifactSource({ ...deps, getCurrent: async () => snapshot, getBlob: async () => content }, { artifactId });
    expect(output.files).toHaveLength(32);
    expect(output.files.reduce((total, file) => total + file.bytes.length, 0)).toBe(262144);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(2097152);
    const wire = encodeToolResult({ ok: true, output, auditId: 'budget-test', redactionClass: 'low' });
    expect(Buffer.byteLength(JSON.stringify(wire))).toBeLessThan(2097152);
    expect(JSON.parse((wire.content[0] as { text: string }).text)).toEqual(output);
    await expect(readArtifactSource(deps, { artifactId, paths: [] })).rejects.toThrow('invalid_request');
  });
});
