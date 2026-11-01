import { createHash } from 'node:crypto';
import { parseManifest } from '../codecs.js';
import { ArtifactOperationError } from './failures.js';
import type { SourceRef } from './sources.js';

export interface SourceReadPorts {
  storageScopeId?: string;
  authorize(): Promise<void>;
  getCurrent(artifactId: string): Promise<{ releaseId: string; manifest: string } | undefined>;
  getRelease(releaseId: string): Promise<{ releaseId: string; manifest: string; state?: string } | undefined>;
  getSource(artifactId: string): Promise<SourceRef | undefined>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
  urls?: (artifactId: string, releaseId: string) => { stableUrl: string; pinnedUrl: string };
  maxFiles: number;
  maxTotalBytes: number;
}
export interface SourceReadInput { artifactId: string; releaseId?: string; paths?: readonly string[] }
interface ManifestFile { path: string; mimeType: string; digest: string; size: number }

/** Read author bytes only. Provenance never substitutes for a stored snapshot. */
export async function readArtifactSource(ports: SourceReadPorts, input: SourceReadInput) {
  await ports.authorize();
  const release = input.releaseId === undefined ? await ports.getCurrent(input.artifactId)
    : await ports.getRelease(input.releaseId);
  if (!release) throw new ArtifactOperationError(input.releaseId ? 'not_found' : 'gone');
  let manifest;
  try { manifest = parseManifest(release.manifest); }
  catch (cause) { throw new ArtifactOperationError('verification_failed', { cause }); }
  if (manifest.artifactId !== input.artifactId) throw new ArtifactOperationError('not_found');
  if (ports.storageScopeId !== undefined && manifest.storageScopeId !== ports.storageScopeId) throw new ArtifactOperationError('verification_failed');
  if ('manifestDigest' in release && release.manifestDigest !== manifest.digest) throw new ArtifactOperationError('verification_failed');
  if ('state' in release && release.state === 'purged') throw new ArtifactOperationError('gone');
  if (!manifest.digest || !Array.isArray(manifest.files) || manifest.files.length > ports.maxFiles) {
    throw new ArtifactOperationError('verification_failed');
  }
  const entries: ManifestFile[] = [];
  const paths = new Set<string>();
  let total = 0;
  for (const value of manifest.files) {
    const file = value as ManifestFile;
    if (!file || typeof file.path !== 'string' || typeof file.mimeType !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(file.digest) || !Number.isSafeInteger(file.size) || file.size < 0 ||
      paths.has(file.path)) throw new ArtifactOperationError('verification_failed');
    total += file.size;
    if (total > ports.maxTotalBytes) throw new ArtifactOperationError('unprocessable');
    paths.add(file.path);
    entries.push(file);
  }
  if (input.paths !== undefined && (!input.paths.length || input.paths.length > ports.maxFiles ||
    new Set(input.paths).size !== input.paths.length || input.paths.some((path) => !paths.has(path)))) {
    throw new ArtifactOperationError('invalid_request');
  }
  const selected = input.paths === undefined ? entries : entries.filter((file) => input.paths!.includes(file.path));
  const files = [];
  for (const file of selected) {
    const bytes = await ports.getBlob(`artifacts/${manifest.storageScopeId}/blobs/sha256/${file.digest.slice(7)}`);
    if (!bytes || bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== file.digest.slice(7)) {
      throw new ArtifactOperationError('verification_failed');
    }
    files.push({ ...file, bytes: Array.from(bytes) });
  }
  const sourceRef = await ports.getSource(input.artifactId) ?? null;
  await ports.authorize();
  return { artifactId: input.artifactId, releaseId: release.releaseId, digest: manifest.digest,
    manifest: release.manifest, files, sourceRef, ...ports.urls?.(input.artifactId, release.releaseId) };
}
