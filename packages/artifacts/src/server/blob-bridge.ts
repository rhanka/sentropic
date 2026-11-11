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
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { blobDigestOfKey, type BlobKeyPage, type PublicationBlobStore } from './publication.js';
import { assertBlobPrefix } from './blob-prefix.js';

/** Per-process pagination secret: cursors are unforgeable without it, invalid after restart. */
const PAGE_MAC_KEY = randomBytes(32);

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

/**
 * CMF-S1 (CR-4) — sealed page-cursor states. `keyset` resumes after a full
 * key (offset-free, so a byte-trimmed page replays exactly); `offset` serves
 * the in-memory fallback for stores without `listKeysPaged`. Composite stores
 * seal their own dual state (see `composite-blob.ts`). States are opaque to
 * callers and bound to their prefix scope: a foreign or tampered cursor is
 * refused, never applied.
 */
export type BlobPageCursorState =
  | { readonly kind: 'keyset'; readonly after?: string }
  | { readonly kind: 'offset'; readonly offset: number };

interface SealedCursor {
  readonly v: 1;
  readonly prefix: string;
  readonly state: BlobPageCursorState;
  readonly tag: string;
}

function cursorTag(prefix: string, state: string): string {
  return createHmac('sha256', PAGE_MAC_KEY).update(`blob-page/v1:${prefix}\n${state}`).digest('hex');
}

/** Seal a cursor state for a prefix scope (opaque, integrity-protected). */
export function sealBlobPageCursor(prefix: string, state: BlobPageCursorState): string {
  const encoded = JSON.stringify(state);
  const cursor: SealedCursor = { v: 1, prefix, state: JSON.parse(encoded) as BlobPageCursorState,
    tag: cursorTag(prefix, encoded) };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Open a sealed cursor for a prefix scope (rejects foreign/tampered states). */
export function openBlobPageCursor(continuation: string, prefix: string): BlobPageCursorState {
  let parsed: SealedCursor;
  try {
    parsed = JSON.parse(Buffer.from(continuation, 'base64url').toString('utf8')) as SealedCursor;
  } catch {
    throw new Error('invalid blob page continuation');
  }
  const state = parsed?.state;
  const validKind = state?.kind === 'keyset' || state?.kind === 'offset';
  const validOffset = state?.kind !== 'offset' || (typeof state.offset === 'number' &&
    Number.isSafeInteger(state.offset) && state.offset >= 0);
  const validAfter = state?.kind !== 'keyset' || state.after === undefined || typeof state.after === 'string';
  if (parsed?.v !== 1 || !validKind || !validOffset || !validAfter || parsed.prefix !== prefix ||
    parsed.tag !== cursorTag(parsed.prefix, JSON.stringify(state))) {
    throw new Error('invalid blob page continuation');
  }
  return state;
}

/**
 * Trim a key list to the encoded-byte budget (CR-4). The first key is always
 * kept (a single key larger than the budget fails closed instead of looping
 * forever); the caller resumes after the last kept key.
 */
export function cutBlobKeysByBudget(keys: readonly string[], maxEncodedBytes: number): {
  kept: string[]; dropped: number;
} {
  const kept: string[] = [];
  let encoded = 0;
  for (const key of keys) {
    const size = Buffer.byteLength(key, 'utf8');
    if (size > maxEncodedBytes) throw new Error('blob key exceeds page byte budget');
    if (kept.length > 0 && encoded + size > maxEncodedBytes) break;
    kept.push(key);
    encoded += size;
  }
  return { kept, dropped: keys.length - kept.length };
}

function encodeCursor(prefix: string, offset: number): string {
  return sealBlobPageCursor(prefix, { kind: 'offset', offset });
}

function decodeCursor(continuation: string, prefix: string): number {
  const state = openBlobPageCursor(continuation, prefix);
  if (state.kind !== 'offset') throw new Error('invalid blob page continuation');
  return state.offset;
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
  return { keys, continuation: encodeCursor(prefix, index) };
}

/**
 * Bounded key enumeration over any blob store (CR-4).
 * Stores with `listKeysPaged` page at the backend (keyset resume, bounded
 * work per call); the rest fall back to `listKeys` + in-memory slicing.
 * Either way every page honors the item and encoded-byte budgets and carries
 * an opaque scope-bound integrity-protected continuation forward.
 */
export async function listBlobKeysPaged(
  store: Pick<PublicationBlobStore, 'listKeys' | 'listKeysPaged'>,
  prefix: string,
  page: BoundedBlobPage,
): Promise<BoundedBlobKeys> {
  assertBlobPrefix(prefix);
  if (!Number.isSafeInteger(page.maxItems) || page.maxItems < 1) throw new Error('invalid blob page maxItems');
  if (!Number.isSafeInteger(page.maxEncodedBytes) || page.maxEncodedBytes < 1) {
    throw new Error('invalid blob page maxEncodedBytes');
  }
  if (store.listKeysPaged !== undefined) {
    const after = page.continuation === undefined ? undefined : (() => {
      const state = openBlobPageCursor(page.continuation, prefix);
      if (state.kind !== 'keyset') throw new Error('invalid blob page continuation');
      if (state.after !== undefined && !state.after.startsWith(prefix)) {
        throw new Error('invalid blob page continuation');
      }
      return state.after;
    })();
    const side: BlobKeyPage = after === undefined
      ? { maxItems: page.maxItems, maxEncodedBytes: page.maxEncodedBytes }
      : { maxItems: page.maxItems, maxEncodedBytes: page.maxEncodedBytes, startAfter: after };
    const result = await store.listKeysPaged(prefix, side);
    const capped = result.keys.slice(0, page.maxItems);
    const { kept, dropped } = cutBlobKeysByBudget(capped, page.maxEncodedBytes);
    const done = !result.hasMore && dropped === 0 && result.keys.length === capped.length;
    if (kept.length === 0) {
      if (result.keys.length === 0 && !result.hasMore) return { keys: [] };
      throw new Error('blob key exceeds page byte budget');
    }
    if (done) return { keys: kept };
    return { keys: kept, continuation: sealBlobPageCursor(prefix,
      { kind: 'keyset', after: kept[kept.length - 1] }) };
  }
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
    ...(upstream.listKeysPaged === undefined ? {} : {
      async listKeysPaged(prefix: string, page: BlobKeyPage) {
        return upstream.listKeysPaged!(prefix, page);
      },
    }),
    async deleteBlob(key: string): Promise<void> {
      await upstream.deleteBlob(key);
    },
  };
}
