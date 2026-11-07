import { createHash } from 'node:crypto';
import { safeDependencyPath } from './integrity';

export interface TransferFile { path: string; mode: number; bytes: Uint8Array }
export interface TreeLimits { files: number; fileBytes: number; totalBytes: number }
export type TransferTarget = 'workspace' | 'dependencies' | 'overlay' | 'install' | 'npm-cache';
export type TransferFailure = (kind: 'limit' | 'invalid') => never;
/** Raw bytes per put frame: base64 plus entry metadata stays under MAX_FRAME_BYTES. */
export const CHUNK_BYTES = 768 * 1024;
const PUT_ENTRIES = 256;
const PAGE_ENTRIES = 4096;
export const TREE_LIMITS = Object.freeze({ files: 65_536, fileBytes: 16 * 1024 * 1024, totalBytes: 512 * 1024 * 1024 });
/** A-LIVE §8.3 stable output snapshot ceilings. */
export const OUTPUT_LIMITS = Object.freeze({ files: 255, fileBytes: 16777216, totalBytes: 67108864 });
const MODES = new Set([0o444, 0o555, 0o644, 0o755]);
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const byPath = (a: unknown[], b: unknown[]) => (String(a[0]) < String(b[0]) ? -1 : 1);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function checkTree(files: readonly TransferFile[], limits: TreeLimits, fail: TransferFailure) {
  if (files.length > limits.files) fail('limit');
  const paths = new Set<string>(); let total = 0;
  for (const file of files) {
    if (!file || !safeDependencyPath(file.path) || paths.has(file.path) || !MODES.has(file.mode)
      || !(file.bytes instanceof Uint8Array)) fail('invalid');
    paths.add(file.path); total += file.bytes.byteLength;
    if (file.bytes.byteLength > limits.fileBytes || total > limits.totalBytes) fail('limit');
  }
  for (const path of paths) {
    const parts = path.split('/'); parts.pop();
    while (parts.length) { if (paths.has(parts.join('/'))) fail('invalid'); parts.pop(); }
  }
}
/** sha256 of the JSON list of [path, mode, size, sha256] sorted by path (UTF-16 code units); the pod recomputes it. */
export function treeDigest(files: readonly TransferFile[], limits: TreeLimits, fail: TransferFailure) {
  checkTree(files, limits, fail);
  return sha256(JSON.stringify(files.map(f => [f.path, f.mode, f.bytes.byteLength, sha256(f.bytes)]).sort(byPath)));
}
/** Canonical candidate manifest digest: [path, size, sha256] sorted by path. Upload re-verification uses the same form. */
export function candidateManifestDigest(files: readonly TransferFile[]) {
  return sha256(JSON.stringify(files.map(f => [f.path, f.bytes.byteLength, sha256(f.bytes)]).sort(byPath)));
}
/** Bounded put frames; a file larger than one chunk spans frames by offset. */
export function putFrames(transfer: string, target: TransferTarget, files: readonly TransferFile[]) {
  const frames: { transfer: string; target: TransferTarget; entries: Record<string, unknown>[] }[] = [];
  let entries: Record<string, unknown>[] = []; let bytes = 0;
  const push = (entry: Record<string, unknown>, size: number) => {
    if (entries.length && (bytes + size > CHUNK_BYTES || entries.length >= PUT_ENTRIES)) {
      frames.push({ transfer, target, entries }); entries = []; bytes = 0;
    }
    entries.push(entry); bytes += size;
  };
  for (const file of files) {
    const size = file.bytes.byteLength; let offset = 0;
    do {
      const slice = Buffer.from(file.bytes.subarray(offset, offset + CHUNK_BYTES));
      push({ path: file.path, mode: file.mode, size, offset, data: slice.toString('base64') }, slice.length);
      offset += slice.length;
    } while (offset < size);
  }
  if (entries.length) frames.push({ transfer, target, entries });
  return frames;
}
/** Trusted reader of a pod snapshot: regular files only (dependency links may be skipped), contiguous slices,
 * no duplicate or unsafe path, limits enforced while streaming and before anything is uploaded. */
export async function readSnapshot(page: (cursor: number) => Promise<Record<string, unknown>>, limits: TreeLimits,
  links: 'refuse' | 'skip', fail: TransferFailure): Promise<TransferFile[]> {
  const files: TransferFile[] = []; const seen = new Set<string>();
  let current: { path: string; mode: number; size: number; chunks: Buffer[]; received: number } | null = null;
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
        if (size > limits.fileBytes || files.length + 1 > limits.files) fail('limit');
        current = { path, mode: Number(entry.mode) & 0o111 ? 0o755 : 0o644, size, chunks: [], received: 0 }; seen.add(path);
      } else if (!current || current.path !== path || current.received !== offset) fail('invalid');
      const open = current!;
      if (open.size !== size || open.received + bytes.length > size || (!bytes.length && size)) fail('invalid');
      total += bytes.length;
      if (total > limits.totalBytes) fail('limit');
      open.chunks.push(bytes); open.received += bytes.length;
      if (open.received === size) { files.push({ path, mode: open.mode, bytes: Buffer.concat(open.chunks) }); current = null; }
    }
    if (next === null) break;
    cursor = next as number;
  }
  if (current) fail('invalid');
  return files;
}
