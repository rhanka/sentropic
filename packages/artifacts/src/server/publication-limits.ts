import type { PublicationFileInput } from './publication.js';

export interface PublicationLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

/**
 * Generic server maxima (files parity LOT 1). A profile above any ceiling
 * fails compilation, and `publicationLimits` refuses overrides above them:
 * the ceiling is generic, the values are profile-owned below it.
 * 255 files per release, 16 MiB per file, 64 MiB per release.
 */
export const SERVER_MAX_FILES_PER_RELEASE = 255;
export const SERVER_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const SERVER_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
/** Concurrent open upload sessions per principal (leaked-URL DoS bound). */
export const SERVER_MAX_UPLOAD_SESSIONS_PER_PRINCIPAL = 8;
/**
 * Generic `get_source` server maxima (files parity LOT 2 §B.3): 32 files, 1 MiB
 * per file, 2 MiB total. A profile may only narrow them; the frozen definition
 * caps `paths` at 32, so larger listings belong to `artifacts_list_assets`.
 */
export const SERVER_MAX_SOURCE_FILES = 32;
export const SERVER_MAX_SOURCE_INLINE_BYTES = 1024 * 1024;
export const SERVER_MAX_SOURCE_TOTAL_BYTES = 2 * 1024 * 1024;

/** Generic defaults: 255 files, 16 MiB per file, 64 MiB total (files parity LOT 1). */
export const DEFAULT_PUBLICATION_LIMITS: Readonly<PublicationLimits> = Object.freeze({
  maxFiles: SERVER_MAX_FILES_PER_RELEASE,
  maxFileBytes: SERVER_MAX_FILE_BYTES,
  maxTotalBytes: SERVER_MAX_TOTAL_BYTES,
});

export function publicationLimits(overrides: Partial<PublicationLimits> = {}): Readonly<PublicationLimits> {
  const limits = { ...DEFAULT_PUBLICATION_LIMITS, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('invalid publication limits');
  }
  if (limits.maxFiles > SERVER_MAX_FILES_PER_RELEASE || limits.maxFileBytes > SERVER_MAX_FILE_BYTES ||
    limits.maxTotalBytes > SERVER_MAX_TOTAL_BYTES) {
    throw new Error('publication limits above the server maxima');
  }
  return Object.freeze(limits);
}

/** Validate before copying bytes, hashing, idempotency lookup or recording intents. */
export function validatePublicationFiles(files: PublicationFileInput[], limits: Readonly<PublicationLimits>): void {
  if (!Array.isArray(files) || files.length === 0 || files.length > limits.maxFiles) {
    throw new Error('invalid publication file count budget');
  }
  const paths = new Set<string>();
  let total = 0;
  for (const file of files) {
    if (typeof file.path !== 'string' || Buffer.byteLength(file.path) > 1024 ||
      /[\\%?#:\u0000-\u001f\u007f]/.test(file.path) ||
      file.path.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new Error('invalid publication path');
    }
    if (paths.has(file.path)) throw new Error('duplicate publication path');
    paths.add(file.path);
    if (typeof file.mimeType !== 'string' || file.mimeType.length === 0 ||
      file.mimeType.length > 256 || /[\u0000-\u001f\u007f]/.test(file.mimeType)) {
      throw new Error('invalid publication MIME type');
    }
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > limits.maxFileBytes) {
      throw new Error('invalid publication file byte budget');
    }
    total += file.bytes.byteLength;
    if (total > limits.maxTotalBytes) throw new Error('invalid publication total byte budget');
  }
}
