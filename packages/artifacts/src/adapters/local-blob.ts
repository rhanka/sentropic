/**
 * U1 — local filesystem PublicationBlobStore, the local equivalent of
 * `createS3BlobStore`. Same key discipline (only
 * `artifacts/<scope>/blobs/sha256/<64 hex>`, hostile keys refused before any
 * I/O, prefix listing sorted, absent reads undefined), plus what S3 cannot
 * offer locally: sha256 digest verification of the stored bytes on put AND
 * read-back, atomic temp-file+rename writes, and strict deletes (unknown keys
 * fail so callers notice, per the port contract).
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PublicationBlobStore } from '../server/publication.js';
import { blobDigestOfKey } from '../server/publication.js';
import { assertBlobPrefix } from '../server/blob-prefix.js';

const BLOB_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;

/** Reject anything but digest-addressed blob keys, before any I/O. */
function assertBlobKey(key: string): void {
  if (!BLOB_KEY_PATTERN.test(key)) {
    throw new Error(`invalid blob key (must be artifacts/<scope>/blobs/sha256/<hex>): ${key}`);
  }
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Create a filesystem-backed blob store rooted at `root` (created on demand). */
export function createLocalBlobStore(root: string): PublicationBlobStore {
  const pathOf = (key: string): string => join(root, ...key.split('/'));
  const walk = (dir: string, prefix: string, out: string[]): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, `${prefix}${entry.name}/`, out);
      } else if (entry.isFile()) {
        out.push(`${prefix}${entry.name}`);
      }
    }
  };
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      assertBlobKey(key);
      const expected = blobDigestOfKey(key).slice('sha256:'.length);
      const actual = sha256Hex(bytes);
      if (actual !== expected) {
        throw new Error(`digest mismatch for blob key ${key}: content sha256:${actual}`);
      }
      const target = pathOf(key);
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      writeFileSync(temp, bytes);
      renameSync(temp, target);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      assertBlobKey(key);
      const target = pathOf(key);
      if (!existsSync(target)) return undefined;
      const bytes = new Uint8Array(readFileSync(target));
      const expected = blobDigestOfKey(key).slice('sha256:'.length);
      const actual = sha256Hex(bytes);
      if (actual !== expected) {
        throw new Error(`digest mismatch on read for blob key ${key}: stored sha256:${actual}`);
      }
      return bytes;
    },
    async listKeys(prefix: string): Promise<string[]> {
      assertBlobPrefix(prefix);
      const keys: string[] = [];
      walk(root, '', keys);
      return keys.filter((key) => key.startsWith(prefix)).sort();
    },
    async deleteBlob(key: string): Promise<void> {
      assertBlobKey(key);
      const target = pathOf(key);
      if (!existsSync(target)) throw new Error(`unknown blob: ${key}`);
      unlinkSync(target);
      // Best-effort prune of now-empty directories up to the root.
      let dir = dirname(target);
      while (dir.startsWith(root) && dir !== root) {
        try { rmSync(dir, { recursive: false }); } catch { break; }
        dir = dirname(dir);
      }
    },
  };
}