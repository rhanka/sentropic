import { createHash } from 'node:crypto';
import JSZip, { type JSZipObject } from 'jszip';

import {
  TransferArchiveLimitError,
  type TransferArchive,
  type TransferArchiveEntry,
  type TransferArchiveHashPort,
  type TransferArchiveLimits,
  type TransferManifestFile,
} from './transfers';

export const TRANSFER_ARCHIVE_LIMITS: TransferArchiveLimits = {
  maxArchiveBytes: 64 * 1024 * 1024,
  maxEntries: 2_048,
  maxEntryBytes: 32 * 1024 * 1024,
  maxUncompressedBytes: 256 * 1024 * 1024,
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(
    (key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`,
  ).join(',')}}`;
};

const assertSafePath = (path: string): void => {
  const segments = path.split('/');
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new TransferArchiveLimitError(`Unsafe archive path: ${path}`);
  }
};

const uncompressedSize = (entry: JSZipObject): number | null => {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })
    ._data?.uncompressedSize;
  return typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : null;
};

class BoundedJsZipArchive implements TransferArchive {
  private entries = 0;
  private uncompressedBytes = 0;

  constructor(
    private readonly zip: JSZip,
    private readonly limits: TransferArchiveLimits,
    loadedEntries: readonly JSZipObject[] = [],
  ) {
    for (const entry of loadedEntries) {
      const originalPath = entry.unsafeOriginalName ?? entry.name;
      assertSafePath(originalPath);
      const size = uncompressedSize(entry);
      if (size === null) throw new TransferArchiveLimitError('Archive entry size is unavailable');
      this.reserve(originalPath, size);
    }
  }

  private reserve(path: string, bytes: number): void {
    if (bytes > this.limits.maxEntryBytes) {
      throw new TransferArchiveLimitError(`Archive entry exceeds limit: ${path}`);
    }
    if (++this.entries > this.limits.maxEntries) {
      throw new TransferArchiveLimitError('Archive entry count exceeds limit');
    }
    this.uncompressedBytes += bytes;
    if (this.uncompressedBytes > this.limits.maxUncompressedBytes) {
      throw new TransferArchiveLimitError('Archive uncompressed size exceeds limit');
    }
  }

  read(path: string): TransferArchiveEntry | null {
    const entry = this.zip.file(path);
    if (!entry) return null;
    return {
      bytes: async () => entry.async('uint8array'),
      text: async () => entry.async('string'),
    };
  }

  write(path: string, bytes: Uint8Array): void {
    assertSafePath(path);
    if (this.zip.file(path)) throw new TransferArchiveLimitError(`Duplicate archive path: ${path}`);
    this.reserve(path, bytes.byteLength);
    this.zip.file(path, bytes, { createFolders: false });
  }

  async generate(): Promise<Uint8Array> {
    const bytes = await this.zip.generateAsync({ type: 'uint8array' });
    if (bytes.byteLength > this.limits.maxArchiveBytes) {
      throw new TransferArchiveLimitError('Archive compressed size exceeds limit');
    }
    return bytes;
  }
}

export const createProductTransferArchivePort = (
  limits: TransferArchiveLimits = TRANSFER_ARCHIVE_LIMITS,
): TransferArchiveHashPort => ({
  limits,
  create: () => new BoundedJsZipArchive(new JSZip(), limits),
  async open(bytes) {
    if (bytes.byteLength > limits.maxArchiveBytes) {
      throw new TransferArchiveLimitError('Archive compressed size exceeds limit');
    }
    const zip = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    return new BoundedJsZipArchive(zip, limits, entries);
  },
  encodeJson(value) {
    const bytes = new TextEncoder().encode(stableStringify(value));
    if (bytes.byteLength > limits.maxEntryBytes) {
      throw new TransferArchiveLimitError('Encoded JSON exceeds entry limit');
    }
    return bytes;
  },
  sha256(bytes) {
    if (bytes.byteLength > limits.maxEntryBytes) {
      throw new TransferArchiveLimitError('Hash input exceeds entry limit');
    }
    return createHash('sha256').update(bytes).digest('hex');
  },
  validateManifest(files: readonly TransferManifestFile[]) {
    if (files.length > limits.maxEntries) {
      throw new TransferArchiveLimitError('Manifest entry count exceeds limit');
    }
    const paths = new Set<string>();
    let total = 0;
    for (const file of files) {
      assertSafePath(file.path);
      if (paths.has(file.path)) {
        throw new TransferArchiveLimitError(`Duplicate manifest path: ${file.path}`);
      }
      paths.add(file.path);
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0
        || file.bytes > limits.maxEntryBytes) {
        throw new TransferArchiveLimitError(`Manifest entry exceeds limit: ${file.path}`);
      }
      if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
        throw new TransferArchiveLimitError(`Invalid manifest hash: ${file.path}`);
      }
      total += file.bytes;
      if (total > limits.maxUncompressedBytes) {
        throw new TransferArchiveLimitError('Manifest uncompressed size exceeds limit');
      }
    }
  },
});
