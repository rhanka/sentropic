import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { Readable } from 'node:stream';
import { safeDependencyPath } from './integrity';
/** `node:zlib` zstd frame support (runtime Node ≥ 22.15, including the API Node 24 and builder Node 26 images;
 * the pinned `@types/node` predates the declarations, so access is capability-checked, never assumed). */
interface ZstdShape {
  createZstdCompress(options?: unknown): NodeJS.ReadWriteStream;
  createZstdDecompress(options?: unknown): NodeJS.ReadWriteStream;
}
function zstd(): ZstdShape {
  const candidate = zlib as unknown as Partial<ZstdShape>;
  if (typeof candidate.createZstdCompress !== 'function' || typeof candidate.createZstdDecompress !== 'function') {
    throw new Error('zstd_unavailable');
  }
  return candidate as ZstdShape;
}

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
  links: 'refuse' | 'skip', fail: TransferFailure, sink: (file: TransferFile) => Promise<void>,
  onPage?: () => void): Promise<void> {
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
    onPage?.();
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

/** One sealed-unit member: a regular dependency file with a cache manifest mode (0444/0555 on the wire). */
export interface UstarMember { path: string; mode: 292 | 365; bytes: Uint8Array }
/** Wire modes of a sealed unit member (the only modes the bounded reader accepts). */
const ustarMode = (mode: 292 | 365): 0o444 | 0o555 => mode === 365 ? 0o555 : 0o444;
const RECORD = 512;
/** Deterministic ustar header of one member: zeroed mtime/uid/gid, sorting by path done by the caller. The tree
 * walk that feeds the seal is already deterministic, so identical trees seal to identical bytes. */
export function ustarHeader(member: { path: string; mode: 292 | 365; size: number }, fail: TransferFailure): Uint8Array {
  if (!member || !safeDependencyPath(member.path) || member.path.split('/').includes('.git')
    || ![292, 365].includes(member.mode) || !Number.isSafeInteger(member.size) || member.size < 0) fail('invalid');
  const raw = Buffer.byteLength(member.path);
  if (raw === 0 || raw > 255) fail('invalid');
  let name = member.path; let prefix = '';
  if (raw > 100) {
    const cut = member.path.lastIndexOf('/', 155);
    if (cut <= 0 || cut >= member.path.length - 1 || Buffer.byteLength(member.path.slice(0, cut)) > 155
      || Buffer.byteLength(member.path.slice(cut + 1)) > 100) fail('invalid');
    prefix = member.path.slice(0, cut); name = member.path.slice(cut + 1);
  }
  const header = Buffer.alloc(RECORD, 0);
  header.write(name, 0, 100, 'utf8'); header.write(ustarMode(member.mode).toString(8).padStart(7, '0'), 100, 8, 'utf8');
  header.write('0'.repeat(8), 108, 8, 'utf8'); header.write('0'.repeat(8), 116, 8, 'utf8');
  header.write(member.size.toString(8).padStart(11, '0'), 124, 12, 'utf8');
  header.write(' '.repeat(8), 148, 8, 'utf8'); header[156] = 0x30; header.write('ustar\0', 257, 6, 'utf8');
  header.write('00', 263, 2, 'utf8'); header.write(prefix, 345, 155, 'utf8');
  let checksum = 0;
  for (let i = 0; i < RECORD; i++) checksum += i >= 148 && i < 156 ? 0x20 : header[i]!;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'utf8');
  return header;
}
/** Deterministic sealed-unit stream (§7.1.2): ustar records (sorted paths, 0444/0555, zeroed mtime/uid/gid)
 * through one `zstd` frame (default level 3, single-thread). Holds one member plus the compressor window. */
export async function* tarZst(members: AsyncIterable<UstarMember>): AsyncGenerator<Uint8Array> {
  async function* tar(): AsyncGenerator<Uint8Array> {
    for await (const member of members) {
      if (!member || !(member.bytes instanceof Uint8Array)) throw new Error('invalid sealed member');
      yield ustarHeader({ path: member.path, mode: member.mode, size: member.bytes.byteLength }, () => {
        throw new Error('invalid sealed member');
      });
      for (let offset = 0; offset < member.bytes.byteLength; offset += RECORD) {
        const record = Buffer.alloc(RECORD, 0);
        record.set(member.bytes.subarray(offset, Math.min(offset + RECORD, member.bytes.byteLength)), 0);
        yield record;
      }
    }
    yield Buffer.alloc(RECORD, 0); yield Buffer.alloc(RECORD, 0);
  }
  const compressed = Readable.from(tar()).pipe(zstd().createZstdCompress());
  for await (const chunk of compressed) yield chunk as Uint8Array;
}
/** Bounded ustar + zstd reader (§7.2.3): regular files only (no links, devices, absolute/`..` paths — the same
 * refusals as `safeDependencyPath`), wire modes only, running counters against `limits`, decompression ratio
 * bound (refuses past 20:1 or past `totalBytes`, whichever first), streaming extraction. `archiveBytes` is the
 * compressed size the ratio is measured against; the caller rehashes every extracted file. */
export async function* extractTarZst(archive: Uint8Array, archiveBytes: number, limits: TreeLimits,
  fail: TransferFailure): AsyncGenerator<UstarMember> {
  if (!(archive instanceof Uint8Array)) fail('invalid');
  let queue = Buffer.alloc(0); let ended = false; let total = 0; let count = 0;
  const text = (bytes: Buffer, from: number, to: number) => bytes.subarray(from, to).toString('utf8').replace(/\0.*$/, '');
  const take = async (length: number): Promise<Buffer> => {
    while (queue.byteLength < length) {
      if (ended) fail('invalid');
      const piece = await next();
      if (piece === null) { ended = true; continue; }
      queue = Buffer.concat([queue, piece]);
    }
    const out = queue.subarray(0, length); queue = queue.subarray(length);
    return out;
  };
  const decompressed = Readable.from([Buffer.from(archive)]).pipe(zstd().createZstdDecompress());
  const iterator = decompressed[Symbol.asyncIterator]();
  const next = async (): Promise<Uint8Array | null> => {
    try { const step = await iterator.next(); return step.done ? null : step.value as Uint8Array; }
    catch { fail('invalid'); }
  };
  for (;;) {
    const header = await take(RECORD);
    if (header.every(byte => byte === 0)) {
      const second = await take(RECORD);
      if (!second.every(byte => byte === 0)) fail('invalid');
      if (queue.byteLength !== 0) fail('invalid');
      return;
    }
    const magic = header.subarray(257, 263).toString('utf8');
    if (magic !== 'ustar\0') fail('invalid');
    const type = String.fromCharCode(header[156]!);
    if (type !== '0' && type !== '\0') fail('invalid');
    const name = text(header, 0, 100); const prefix = text(header, 345, 500);
    const path = prefix ? `${prefix}/${name}` : name;
    const mode = parseInt(text(header, 100, 108).trim() || '0', 8);
    const size = parseInt(text(header, 124, 136).trim() || '0', 8);
    if (!safeDependencyPath(path) || path.split('/').includes('.git')
      || (mode !== 0o444 && mode !== 0o555) || !Number.isSafeInteger(size) || size < 0) fail('invalid');
    let checksum = 0;
    for (let i = 0; i < RECORD; i++) checksum += i >= 148 && i < 156 ? 0x20 : header[i]!;
    if (checksum !== parseInt(text(header, 148, 156).trim() || '0', 8)) fail('invalid');
    if (size > limits.fileBytes || ++count > limits.files) fail('limit');
    const body = Buffer.alloc(size);
    let read = 0;
    while (read < size) { const piece = await take(Math.min(size - read, 1 << 20)); piece.copy(body, read); read += piece.byteLength; }
    const padding = (RECORD - (size % RECORD)) % RECORD;
    if (padding) await take(padding);
    total += size;
    if (total > limits.totalBytes || total > archiveBytes * 20) fail('limit');
    yield { path, mode: mode === 0o555 ? 365 : 292, bytes: body };
  }
}
