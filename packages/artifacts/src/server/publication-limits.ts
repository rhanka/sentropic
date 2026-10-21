import type { PublicationFileInput } from './publication.js';

export interface PublicationLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}
export const DEFAULT_PUBLICATION_LIMITS: Readonly<PublicationLimits> = Object.freeze({
  maxFiles: 128, maxFileBytes: 16 * 1024 * 1024, maxTotalBytes: 64 * 1024 * 1024,
});

export function publicationLimits(overrides: Partial<PublicationLimits> = {}): Readonly<PublicationLimits> {
  const limits = { ...DEFAULT_PUBLICATION_LIMITS, ...overrides };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error('invalid publication limits');
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
