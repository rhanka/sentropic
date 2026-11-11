/**
 * U1 — local filesystem PublicationBlobStore, the local equivalent of
 * `createS3BlobStore`. Same key discipline (only
 * `artifacts/<scope>/blobs/sha256/<64 hex>`, hostile keys refused before any
 * I/O, prefix listing sorted, absent reads undefined), plus what S3 cannot
 * offer locally: sha256 digest verification of the stored bytes on put AND
 * read-back, atomic temp-file+rename writes, and strict deletes (unknown keys
 * fail so callers notice, per the port contract).
 */
import { existsSync, linkSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { PublicationBlobStore } from '../server/publication.js';
import { assertBlobPrefix } from '../server/blob-prefix.js';
import { cloneBlobBytes, verifyBytesForKey, verifyStoredBytesForKey } from '../server/blob-bridge.js';

const BLOB_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;

/** Reject anything but digest-addressed blob keys, before any I/O. */
function assertBlobKey(key: string): void {
  if (!BLOB_KEY_PATTERN.test(key)) {
    throw new Error(`invalid blob key (must be artifacts/<scope>/blobs/sha256/<hex>): ${key}`);
  }
}

function readVerified(key: string, target: string): Uint8Array {
  return verifyStoredBytesForKey(key, new Uint8Array(readFileSync(target)));
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
      // CR-1: clone before verification, then verify before any I/O.
      const snapshot = cloneBlobBytes(bytes);
      verifyBytesForKey(key, snapshot);
      const target = pathOf(key);
      if (existsSync(target)) {
        // Create-only: digest-verified read proves the stored bytes name the
        // key, hence equal the snapshot barring SHA-256 collision.
        readVerified(key, target);
        return;
      }
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`;
      writeFileSync(temp, snapshot, { flag: 'wx' });
      try {
        // Atomic create-only: link fails with EEXIST instead of overwriting.
        linkSync(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          readVerified(key, target);
          return;
        }
        throw error;
      } finally {
        try { unlinkSync(temp); } catch { /* already linked or never created */ }
      }
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      assertBlobKey(key);
      const target = pathOf(key);
      if (!existsSync(target)) return undefined;
      // CR-2: digest verified before serving bytes as verified.
      return readVerified(key, target);
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