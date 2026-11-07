import { createHash } from 'node:crypto';
import { safeDependencyPath } from './integrity';

export interface TransferFile { path: string; mode: number; bytes: Uint8Array }
/** Manifest row of one file; the digest of a tree is computed from these rows, never from bytes held at once. */
export interface TransferEntry { path: string; mode: number; size: number; sha256: string }
export interface TreeLimits { files: number; fileBytes: number; totalBytes: number }
export type TransferTarget = 'workspace' | 'dependencies' | 'overlay' | 'install' | 'npm-cache';
export type TransferFailure = (kind: 'limit' | 'invalid') => never;
/** Raw bytes per put frame: base64 plus entry metadata stays under MAX_FRAME_BYTES. */
export const CHUNK_BYTES = 768 * 1024;
const PUT_ENTRIES = 256;
const PAGE_ENTRIES = 4096;
/** Decision 07/11 (a): dependency and source trees (immo measured 49318 files / 816 MiB installed). */
export const TREE_LIMITS = Object.freeze({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 1024 * 1024 * 1024 });
/** A-LIVE §8.3 stable output snapshot ceilings. */
export const OUTPUT_LIMITS = Object.freeze({ files: 255, fileBytes: 16777216, totalBytes: 67108864 });
const MODES = new Set([0o444, 0o555, 0o644, 0o755]);
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const DIGEST = /^[a-f0-9]{64}$/;
const byPath = (a: unknown[], b: unknown[]) => (String(a[0]) < String(b[0]) ? -1 : 1);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkTree(entries: readonly TransferEntry[], limits: TreeLimits, fail: TransferFailure) {
  if (entries.length > limits.files) fail('limit');
  const paths = new Set<string>(); let total = 0;
  for (const entry of entries) {
    if (!entry || !safeDependencyPath(entry.path) || paths.has(entry.path) || !MODES.has(entry.mode)
      || !Number.isSafeInteger(entry.size) || entry.size < 0 || !DIGEST.test(entry.sha256)) fail('invalid');
    paths.add(entry.path); total += entry.size;
    if (entry.size > limits.fileBytes || total > limits.totalBytes) fail('limit');
  }
  for (const path of paths) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) fail('invalid'); parts.pop(); }
  }
}
export function entryOf(file: TransferFile, fail: TransferFailure): TransferEntry {
  if (!file || !(file.bytes instanceof Uint8Array)) fail('invalid');
  return { path: file.path, mode: file.mode, size: file.bytes.byteLength, sha256: sha256(file.bytes) };
}
/** sha256 of the JSON list of [path, mode, size, sha256] sorted by path (UTF-16 code units); the pod recomputes it. */
export function manifestDigest(entries: readonly TransferEntry[], limits: TreeLimits, fail: TransferFailure) {
  checkTree(entries, limits, fail);
  return sha256(JSON.stringify(entries.map(e => [e.path, e.mode, e.size, e.sha256]).sort(byPath)));
}
export function treeDigest(files: readonly TransferFile[], limits: TreeLimits, fail: TransferFailure) {
  return manifestDigest(files.map(file => entryOf(file, fail)), limits, fail);
}
export type PutFrame = { transfer: string; target: TransferTarget; entries: Record<string, unknown>[] };
/** Bounded put frames, emitted as soon as one fills: a file larger than one chunk spans frames by offset, and a sender
 * holds one file and one frame at a time. */
export function putWriter(transfer: string, target: TransferTarget) {
  let entries: Record<string, unknown>[] = []; let bytes = 0;
  const take = (): PutFrame => { const frame = { transfer, target, entries }; entries = []; bytes = 0; return frame; };
  return {
    *add(file: TransferFile): Generator<PutFrame> {
      const size = file.bytes.byteLength; let offset = 0;
      do {
        const slice = Buffer.from(file.bytes.subarray(offset, offset + CHUNK_BYTES));
        if (entries.length && (bytes + slice.length > CHUNK_BYTES || entries.length >= PUT_ENTRIES)) yield take();
        entries.push({ path: file.path, mode: file.mode, size, offset, data: slice.toString('base64') }); bytes += slice.length;
        offset += slice.length;
      } while (offset < size);
    },
    *end(): Generator<PutFrame> { if (entries.length) yield take(); },
  };
}
/** Trusted reader of a pod snapshot: regular files only (dependency links may be skipped), contiguous slices,
 * no duplicate or unsafe path, limits enforced while streaming. Each finished file goes to `sink` before the next page
 * is read, so the reader holds one file (at most `fileBytes`) and one bounded reply. */
export async function streamSnapshot(page: (cursor: number) => Promise<Record<string, unknown>>, limits: TreeLimits,
  links: 'refuse' | 'skip', fail: TransferFailure, sink: (file: TransferFile) => Promise<void>): Promise<void> {
  const seen = new Set<string>(); let count = 0;
  let current: { path: string; mode: number; size: number; bytes: Buffer; received: number } | null = null;
  let total = 0; let cursor = 0; let budget = limits.files + Math.ceil(limits.totalBytes / 4096);
  for (;;) {
    const data = await page(cursor);
    const next = data.next;
    if (!Array.isArray(data.entries) || data.entries.length > PAGE_ENTRIES
      || (next !== null && (!Number.isSafeInteger(next) || (next as number) <= cursor || !data.entries.length))) fail('invalid');
    for (const entry of data.entries as unknown[]) {
      if (--budget < 0) fail('limit');
      if (!record(entry) || typeof entry.path !== 'string' || !safeDependencyPath(entry.path) || typeof entry.data !== 'string'
        || !Number.isSafeInteger(entry.size) || (entry.size as number) < 0 || !Number.isSafeInteger(entry.offset)) fail('invalid');
      const path = entry.path as string; const size = entry.size as number; const offset = entry.offset as number;
      if (entry.type === 'symlink' && links === 'skip' && !current && !seen.has(path)) { seen.add(path); continue; }
      if (entry.type !== 'file') fail('invalid');
      const bytes = Buffer.from(entry.data as string, 'base64');
      if (bytes.toString('base64') !== entry.data) fail('invalid');
      if (offset === 0) {
        if (current || seen.has(path)) fail('invalid');
        if (size > limits.fileBytes || ++count > limits.files) fail('limit');
        current = { path, mode: Number(entry.mode) & 0o111 ? 0o755 : 0o644, size, bytes: Buffer.alloc(size), received: 0 };
        seen.add(path);
      } else if (!current || current.path !== path || current.received !== offset) fail('invalid');
      const open = current!;
      if (open.size !== size || open.received + bytes.length > size || (!bytes.length && size)) fail('invalid');
      total += bytes.length;
      if (total > limits.totalBytes) fail('limit');
      bytes.copy(open.bytes, open.received); open.received += bytes.length;
      if (open.received === size) { current = null; await sink({ path, mode: open.mode, bytes: open.bytes }); }
    }
    if (next === null) break;
    cursor = next as number;
  }
  if (current) fail('invalid');
}
/** Collecting form for the bounded stable output (A-LIVE §8.3): at most OUTPUT_LIMITS bytes are ever held. */
export async function readSnapshot(page: (cursor: number) => Promise<Record<string, unknown>>, limits: TreeLimits,
  links: 'refuse' | 'skip', fail: TransferFailure): Promise<TransferFile[]> {
  const files: TransferFile[] = [];
  await streamSnapshot(page, limits, links, fail, async file => { files.push(file); });
  return files;
}
