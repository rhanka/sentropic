import { createHash } from 'node:crypto';
import { parseManifest } from '../codecs.js';
import { ArtifactOperationError } from './failures.js';
import { TEXT_MIME_RE } from './mime.js';
import { API_GUIDE_REF } from './templates.js';
import type { SourceRef } from './sources.js';
import type { PublicationService } from './publication.js';

export interface SourceReadPorts {
  storageScopeId?: string;
  authorize(): Promise<void>;
  getCurrent: PublicationService['getCurrent'];
  getRelease: PublicationService['getRelease'];
  getSource(artifactId: string): Promise<SourceRef | undefined>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
  urls?: (artifactId: string, releaseId: string) => { stableUrl: string; versionUrl: string };
  /** Guide reference returned instead of embedding the guide body. */
  guideRef?: { tool: string; version: string };
  /** Data-file slots per call (`sourceFilesMax`, server ceiling 32). */
  maxFiles: number;
  /** Per-file raw-byte budget (`sourceInlineFileBytesMax`, server ceiling 1 MiB). */
  maxInlineBytes: number;
  /** Raw-byte budget for files with data (`sourceTotalBytesMax`, server ceiling 2 MiB). */
  maxTotalBytes: number;
}
export interface SourceReadInput { artifactId: string; releaseId?: string; paths?: readonly string[] }
interface ManifestFile { path: string; mimeType: string; digest: string; size: number }

/** Read author bytes only. Provenance never substitutes for a stored snapshot. */
export async function readArtifactSource(ports: SourceReadPorts, input: SourceReadInput) {
  await ports.authorize();
  const release = input.releaseId === undefined ? await ports.getCurrent(input.artifactId)
    : await ports.getRelease(input.releaseId);
  if (!release) throw input.releaseId ? new ArtifactOperationError('not_found')
    : new ArtifactOperationError('release_unavailable', { publicDetails: { reason: 'unpublished' } });
  if ((input.releaseId !== undefined && release.releaseId !== input.releaseId) ||
    release.artifactId !== input.artifactId) throw new ArtifactOperationError('not_found');
  let manifest;
  try { manifest = parseManifest(release.manifest); }
  catch (cause) { throw new ArtifactOperationError('verification_failed', { cause }); }
  if (manifest.artifactId !== input.artifactId) throw new ArtifactOperationError('not_found');
  if (ports.storageScopeId !== undefined && manifest.storageScopeId !== ports.storageScopeId) throw new ArtifactOperationError('verification_failed');
  if (release.manifestDigest !== manifest.digest) throw new ArtifactOperationError('verification_failed');
  if (release.state === 'purged') throw new ArtifactOperationError('release_unavailable', { publicDetails: { reason: 'purged' } });
  if (!manifest.digest || !Array.isArray(manifest.files)) {
    throw new ArtifactOperationError('verification_failed');
  }
  const entries: ManifestFile[] = [];
  const paths = new Set<string>();
  for (const value of manifest.files) {
    const file = value as ManifestFile;
    if (!file || typeof file.path !== 'string' || typeof file.mimeType !== 'string' ||
      !/^sha256:[0-9a-f]{64}$/.test(file.digest) || !Number.isSafeInteger(file.size) || file.size < 0 ||
      paths.has(file.path)) throw new ArtifactOperationError('verification_failed');
    paths.add(file.path);
    entries.push(file);
  }
  if (input.paths !== undefined && (!input.paths.length || input.paths.length > ports.maxFiles ||
    new Set(input.paths).size !== input.paths.length || input.paths.some((path) => !paths.has(path)))) {
    throw new ArtifactOperationError('invalid_request');
  }
  const selected = input.paths === undefined ? entries : entries.filter((file) => input.paths!.includes(file.path));
  // LOT 2 §B.3: failure turns into data. Files are evaluated in manifest
  // order against raw-byte budgets: above the per-file cap they are
  // `too_large`; past the slot or total budget they are `over_total_budget`.
  // Previously successful reads (within every budget) are byte-identical.
  const files: ({ path: string; mimeType: string; size: number; digest: string } &
    ({ text: string; encoding: 'utf8' } | { base64: string; encoding: 'base64' } |
      { omitted: 'too_large' | 'over_total_budget' }))[] = [];
  let dataFiles = 0;
  let dataTotal = 0;
  for (const file of selected) {
    if (file.size > ports.maxInlineBytes) {
      files.push({ ...file, omitted: 'too_large' });
      continue;
    }
    if (dataFiles >= ports.maxFiles || dataTotal + file.size > ports.maxTotalBytes) {
      files.push({ ...file, omitted: 'over_total_budget' });
      continue;
    }
    const bytes = await ports.getBlob(`artifacts/${manifest.storageScopeId}/blobs/sha256/${file.digest.slice(7)}`);
    if (!bytes) throw new ArtifactOperationError('release_unavailable', { publicDetails: { reason: 'not_retained' } });
    if (bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== file.digest.slice(7)) {
      throw new ArtifactOperationError('verification_failed');
    }
    // Verified raw bytes are encoded for the wire: text mime types as UTF-8
    // text, everything else (including non-UTF-8 "text") as base64. Never an
    // integer array, which blows the tool-result budget on small pages.
    let text: string | undefined;
    if (TEXT_MIME_RE.test(file.mimeType)) {
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { /* Not valid UTF-8: fall back to base64. */ }
    }
    files.push({ ...file, ...(text !== undefined
      ? { text, encoding: 'utf8' as const }
      : { base64: Buffer.from(bytes).toString('base64'), encoding: 'base64' as const }) });
    dataFiles += 1;
    dataTotal += file.size;
  }
  const sourceRef = await ports.getSource(input.artifactId) ?? null;
  await ports.authorize();
  return { artifactId: input.artifactId, releaseId: release.releaseId, digest: manifest.digest,
    manifest: release.manifest, files, sourceRef, guideRef: ports.guideRef ?? API_GUIDE_REF,
    ...ports.urls?.(input.artifactId, release.releaseId) };
}
