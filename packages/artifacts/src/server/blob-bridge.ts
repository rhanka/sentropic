/**
 * CMF-S1 — hardened blob bridge (MODULE_STORAGE CR-1/CR-2/CR-4).
 *
 * Additive on the 0.2.x line: the `PublicationBlobStore` shape is unchanged.
 * This module adds the guard every blob write/read passes through on CM:
 * caller-buffer clone before verification (CR-1), sha256-of-bytes against the
 * key digest before any I/O, create-only writes (identical retry idempotent,
 * different bytes refused without touching the stored object), digest-verified
 * reads (CR-2), and bounded key pages with an opaque scope-bound
 * integrity-tagged continuation (CR-4).
 *
 * The page shape is structural with `CommonBoundedPage`
 * (`@sentropic/cluster-mesh` `storage/common-contract.ts`): same fields, no
 * dependency from this package to cluster-mesh.
 */
import { createHash } from 'node:crypto';
import { blobDigestOfKey, type PublicationBlobStore } from './publication.js';
import { assertBlobPrefix } from './blob-prefix.js';

export interface BoundedBlobPage {
  readonly maxItems: number;
  readonly maxEncodedBytes: number;
  readonly continuation?: string;
}

export interface BoundedBlobKeys {
  readonly keys: string[];
  readonly continuation?: string;
}

const BLOB_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;

/** Clone the caller buffer so verification never observes a mutated view. */
export function cloneBlobBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Fail closed before any I/O when the bytes do not name the key digest.
 * Returns the verified digest (`sha256:<hex>`).
 */
export function verifyBytesForKey(key: string, bytes: Uint8Array): string {
  if (!BLOB_KEY_PATTERN.test(key)) throw new Error(`invalid blob key: ${key}`);
  const expected = blobDigestOfKey(key);
  const actual = `sha256:${sha256Hex(bytes)}`;
  if (actual !== expected) throw new Error(`digest mismatch for blob key ${key}: content ${actual}`);
  return expected;
}

/** Fail closed when stored bytes no longer name their key (CR-2). */
export function verifyStoredBytesForKey(key: string, bytes: Uint8Array): Uint8Array {
  verifyBytesForKey(key, bytes);
  return bytes;
}

interface PageCursor {
  readonly v: 1;
  readonly prefix: string;
  readonly offset: number;
  readonly tag: string;
}

function cursorTag(prefix: string, offset: number): string {
  return createHash('sha256').update(`blob-page/v1:${prefix}:${offset}`).digest('hex');
}

function encodeCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(continuation: string, prefix: string): number {
  let parsed: PageCursor;
  try {
    parsed = JSON.parse(Buffer.from(continuation, 'base64url').toString('utf8')) as PageCursor;
  } catch {
    throw new Error('invalid blob page continuation');
  }
  if (parsed?.v !== 1 || typeof parsed.offset !== 'number' || !Number.isSafeInteger(parsed.offset) ||
    parsed.offset < 0 || parsed.prefix !== prefix || parsed.tag !== cursorTag(parsed.prefix, parsed.offset)) {
    throw new Error('invalid blob page continuation');
  }
  return parsed.offset;
}

/**
 * Bounded slice of an ordered key list under one prefix (CR-4).
 * The continuation is opaque to callers, bound to its prefix scope, and
 * integrity-tagged: a foreign or tampered cursor is refused, never applied.
 */
export function pageBlobKeys(all: readonly string[], prefix: string, page: BoundedBlobPage): BoundedBlobKeys {
  assertBlobPrefix(prefix);
  if (!Number.isSafeInteger(page.maxItems) || page.maxItems < 1) throw new Error('invalid blob page maxItems');
  if (!Number.isSafeInteger(page.maxEncodedBytes) || page.maxEncodedBytes < 1) {
    throw new Error('invalid blob page maxEncodedBytes');
  }
  const offset = page.continuation === undefined ? 0 : decodeCursor(page.continuation, prefix);
  const keys: string[] = [];
  let encoded = 0;
  let index = offset;
  for (; index < all.length && keys.length < page.maxItems; index += 1) {
    const key = all[index]!;
    const size = Buffer.byteLength(key, 'utf8');
    if (keys.length > 0 && encoded + size > page.maxEncodedBytes) break;
    if (size > page.maxEncodedBytes) throw new Error('blob key exceeds page byte budget');
    keys.push(key);
    encoded += size;
  }
  if (index >= all.length) return { keys };
  return { keys, continuation: encodeCursor({ v: 1, prefix, offset: index, tag: cursorTag(prefix, index) }) };
}

/**
 * Bounded key enumeration over any blob store (CR-4).
 * Callers never hold an unbounded key list: every page honors the item and
 * encoded-byte budgets and carries the opaque continuation forward.
 */
export async function listBlobKeysPaged(
  store: Pick<PublicationBlobStore, 'listKeys'>,
  prefix: string,
  page: BoundedBlobPage,
): Promise<BoundedBlobKeys> {
  const all = (await store.listKeys(prefix)).filter((key) => key.startsWith(prefix)).sort();
  return pageBlobKeys(all, prefix, page);
}

/**
 * Wrap an upstream blob store with the bridge guards.
 * putBlob clones first, verifies before any I/O, then delegates to an
 * upstream that implements create-only writes; a conflicting write is
 * settled by read-back: identical bytes are idempotent, different bytes
 * fail closed without overwriting. getBlob verifies digest before serving.
 */
export function createVerifiedBlobStore(upstream: PublicationBlobStore): PublicationBlobStore {
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      const snapshot = cloneBlobBytes(bytes);
      verifyBytesForKey(key, snapshot);
      try {
        await upstream.putBlob(key, snapshot);
      } catch (error) {
        const stored = await upstream.getBlob(key).catch(() => undefined);
        if (stored !== undefined) {
          verifyStoredBytesForKey(key, stored);
          if (stored.byteLength === snapshot.byteLength &&
            sha256Hex(stored) === sha256Hex(snapshot)) return;
        }
        throw error;
      }
      const stored = await upstream.getBlob(key);
      if (stored === undefined) throw new Error(`blob missing after write: ${key}`);
      verifyStoredBytesForKey(key, stored);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      const stored = await upstream.getBlob(key);
      if (stored === undefined) return undefined;
      return verifyStoredBytesForKey(key, stored);
    },
    async getBlobRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | undefined> {
      return upstream.getBlobRange?.(key, start, endInclusive);
    },
    async listKeys(prefix: string): Promise<string[]> {
      return upstream.listKeys(prefix);
    },
    async deleteBlob(key: string): Promise<void> {
      await upstream.deleteBlob(key);
    },
  };
}
