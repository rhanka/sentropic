import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { sha256Hex } from './checksum';
import type {
  ArtifactMetadata,
  ArtifactRef,
  ArtifactStorePort,
  PutArtifactInput,
  PutArtifactResult,
} from './port';
import { ArtifactChecksumMismatchError, ArtifactNotFoundError } from './port';

interface SidecarMeta {
  contentType?: string;
  checksum: string;
  size: number;
  lastModified: string;
}

/**
 * Local-filesystem binding of {@link ArtifactStorePort} for dev / self-host. Objects are
 * written under `<root>/<bucket>/<key>`; a `<key>.meta.json` sidecar carries contentType +
 * checksum so head() answers without re-reading the body.
 */
export class LocalFsArtifactStore implements ArtifactStorePort {
  constructor(
    private readonly root: string,
    private readonly defaultBucketName: string
  ) {}

  // Data and metadata live in separate subtrees so an object key can never collide with
  // another object's sidecar (e.g. key "foo" vs key "foo.meta.json").
  private safePath(subtree: 'blobs' | 'meta', ref: ArtifactRef): string {
    const segs = [sanitizeSegment(ref.bucket), ...ref.key.split('/').map(sanitizeSegment)];
    const base = path.join(this.root, subtree);
    const full = path.join(base, ...segs);
    const resolvedBase = path.resolve(base);
    const resolvedFull = path.resolve(full);
    // Defense-in-depth: segment sanitization already neutralizes '.'/'..'.
    if (resolvedFull !== resolvedBase && !resolvedFull.startsWith(resolvedBase + path.sep)) {
      throw new Error(`artifact path escapes store root: ${ref.bucket}/${ref.key}`);
    }
    return full;
  }

  private objectPath(ref: ArtifactRef): string {
    return this.safePath('blobs', ref);
  }

  private metaPath(ref: ArtifactRef): string {
    return `${this.safePath('meta', ref)}.json`;
  }

  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    const checksum = sha256Hex(input.body);
    if (input.expectedChecksum && input.expectedChecksum !== checksum) {
      throw new ArtifactChecksumMismatchError(input.expectedChecksum, checksum);
    }
    const file = this.objectPath(input);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const body = Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body);
    await fs.writeFile(file, body);
    const meta: SidecarMeta = {
      contentType: input.contentType,
      checksum,
      size: body.byteLength,
      lastModified: new Date().toISOString(),
    };
    await fs.writeFile(this.metaPath(input), JSON.stringify(meta));
    return { ref: { bucket: input.bucket, key: input.key }, checksum, size: body.byteLength };
  }

  async getBytes(ref: ArtifactRef): Promise<Uint8Array> {
    try {
      const buf = await fs.readFile(this.objectPath(ref));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch (err) {
      throw toNotFound(err, ref);
    }
  }

  async getStream(ref: ArtifactRef): Promise<ReadableStream<Uint8Array>> {
    const bytes = await this.getBytes(ref);
    return new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async head(ref: ArtifactRef): Promise<ArtifactMetadata> {
    let meta: SidecarMeta | undefined;
    try {
      meta = JSON.parse(await fs.readFile(this.metaPath(ref), 'utf8')) as SidecarMeta;
    } catch {
      meta = undefined;
    }
    let size = meta?.size;
    if (size === undefined) {
      try {
        size = (await fs.stat(this.objectPath(ref))).size;
      } catch (err) {
        throw toNotFound(err, ref);
      }
    }
    return {
      contentType: meta?.contentType,
      contentLength: size,
      checksum: meta?.checksum,
      lastModified: meta?.lastModified ? new Date(meta.lastModified) : undefined,
    };
  }

  async delete(ref: ArtifactRef): Promise<void> {
    await fs.rm(this.objectPath(ref), { force: true });
    await fs.rm(this.metaPath(ref), { force: true });
  }

  defaultBucket(): string {
    return this.defaultBucketName;
  }
}

function sanitizeSegment(s: string): string {
  const cleaned = s.replace(/[^a-zA-Z0-9._-]/g, '_');
  // Neutralize '', '.' and '..' which would otherwise traverse out of the store root.
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    return cleaned.replace(/\./g, '_') || '_';
  }
  return cleaned;
}

function toNotFound(err: unknown, ref: ArtifactRef): Error {
  const e = err as { code?: string };
  if (e?.code === 'ENOENT') return new ArtifactNotFoundError(ref);
  return err as Error;
}
