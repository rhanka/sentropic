import { ArtifactOperationError } from './failures.js';
import { isWithinMimeCeiling, mimeTypeForPath } from './mime.js';
import { publicationLimits, type PublicationLimits } from './publication-limits.js';

/** One entry of the stable output snapshot, relative to the descriptor outputDir; directories are implicit. */
export interface BuildOutputEntry {
  readonly path: string;
  readonly kind: 'file' | 'symlink' | 'other';
  readonly bytes: number;
}
export interface AdmittedOutputFile {
  readonly path: string;
  readonly bytes: number;
  readonly mimeType: string;
}

const outputPath = (value: unknown): value is string => typeof value === 'string' && Buffer.byteLength(value) <= 1024
  && !/[\\%?#:\u0000-\u001f\u007f]/.test(value) && value.split('/').every(part => part !== '' && part !== '.' && part !== '..');

/**
 * A-LIVE §8.3 / G0 §4.1 pre-flight on the supervisor's inventory, after build processes ended and before
 * hashing or upload: regular files only, canonical unique paths, a mapped MIME type, the descriptor entry
 * present, and the stricter of profile and server ceilings (255 files, 16 MiB per file, 64 MiB in total).
 * Structural faults are verification_failed; ceiling overflow is dist_over_limits; nothing is uploaded.
 */
export function validateBuildOutput(
  entries: readonly BuildOutputEntry[], options: { entry?: string; limits?: Partial<PublicationLimits> } = {},
): readonly AdmittedOutputFile[] {
  const limits = publicationLimits(options.limits);
  const invalid = (): never => { throw new ArtifactOperationError('verification_failed'); };
  const over = (): never => { throw new ArtifactOperationError('dist_over_limits'); };
  if (!Array.isArray(entries) || entries.length === 0) invalid();
  if (entries.length > limits.maxFiles) over();
  const seen = new Set<string>();
  let total = 0;
  const files = entries.map((entry): AdmittedOutputFile => {
    if (entry?.kind !== 'file' || !outputPath(entry.path) || seen.has(entry.path)
      || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0) invalid();
    seen.add(entry.path);
    const mimeType = mimeTypeForPath(entry.path);
    if (mimeType === undefined || !isWithinMimeCeiling(mimeType)) return invalid();
    if (entry.bytes > limits.maxFileBytes) over();
    total += entry.bytes;
    if (total > limits.maxTotalBytes) over();
    return { path: entry.path, bytes: entry.bytes, mimeType };
  });
  if (options.entry !== undefined && !seen.has(options.entry)) invalid();
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
