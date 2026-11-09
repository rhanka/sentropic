import { Readable, Transform, pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { GB1_QUALIFICATION_PATH } from './gb1-qualification';
import { safeDependencyPath } from './integrity';
import { LiveError } from './records';
import type { TransferFile } from './supervisor-transfer';

/** Forge snapshot ceilings (API memory 512Mi: `source()` returns the files as one array). */
export const FORGE_LIMITS = Object.freeze({ files: 65_536, fileBytes: 64 * 1024 * 1024, totalBytes: 192 * 1024 * 1024,
  compressedBytes: 256 * 1024 * 1024 });
const META_BYTES = 1024 * 1024;
const GB1_NAMES = new Set(['package.json', 'package-lock.json', 'sentropic.artifact.json']);
export const unstable = (): never => { throw new LiveError('unstable_tree'); };
const limit = (): never => { throw new LiveError('limit_exceeded', 'forge_snapshot'); };
export interface ForgeTree {
  /** Regular files under `subPath`, relative to it, mode 0644 or 0755. */
  files: TransferFile[];
  /** GB1 inputs by repository path (descriptors, manifests, locks and the qualification file). */
  gb1: Record<string, string>;
}

/** Secret and generated paths, at any depth: never staged, never read. */
function excluded(path: string, subPath: string): boolean {
  const parts = path.split('/');
  if (parts.some(p => p === '.git' || p === 'node_modules' || p.startsWith('.env') || p === '.npmrc'
    || p.startsWith('.yarnrc') || /\.(pem|key|p12|pfx)$/i.test(p))) return true;
  const inner = subPath === '' ? path : path.startsWith(`${subPath}/`) ? path.slice(subPath.length + 1) : null;
  return path.startsWith('ui/dist/') || (inner !== null && inner.startsWith('ui/dist/'));
}
const octal = (field: Buffer) => {
  if (field[0]! & 0x80) return limit();
  const text = field.toString('latin1').replace(/[\0 ]+$/, '').trim();
  return /^[0-7]*$/.test(text) ? Number.parseInt(text || '0', 8) : unstable();
};
const cstring = (field: Buffer) => { const end = field.indexOf(0); return field.subarray(0, end < 0 ? field.length : end).toString('utf8'); };
function checksum(header: Buffer) {
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : header[i]!;
  return sum === octal(header.subarray(148, 156));
}
function pax(data: Buffer): Record<string, string> {
  const records: Record<string, string> = {}; let at = 0;
  while (at < data.length) {
    const space = data.indexOf(0x20, at); const length = Number(data.subarray(at, space).toString('latin1'));
    if (space < 0 || !Number.isSafeInteger(length) || length <= 0 || at + length > data.length) return unstable();
    const line = data.subarray(space + 1, at + length - 1).toString('utf8'); const eq = line.indexOf('=');
    if (eq > 0) records[line.slice(0, eq)] = line.slice(eq + 1);
    at += length;
  }
  return records;
}
/** Exact-size reads over the gunzipped stream; skipped bytes are never held. */
function reader(source: AsyncIterable<Buffer>) {
  const it = source[Symbol.asyncIterator](); let head = Buffer.alloc(0);
  return async (n: number, keep: boolean): Promise<Buffer> => {
    const parts: Buffer[] = []; let need = n;
    while (need > 0) {
      if (head.length === 0) { const next = await it.next(); if (next.done) return unstable(); head = next.value; continue; }
      const slice = head.subarray(0, need); head = head.subarray(slice.length); need -= slice.length;
      if (keep) parts.push(slice);
    }
    return keep ? Buffer.concat(parts, n) : Buffer.alloc(0);
  };
}

/** Streams a GitHub tarball (gzip + tar): strips the top directory, keeps regular files under `subPath`, refuses links
 * and special entries, excludes secrets, generated output and the descriptor `outputDir`, and enforces the limits. */
export async function readForgeTarball(body: ReadableStream<Uint8Array>, subPath: string): Promise<ForgeTree> {
  let compressed = 0;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, done) {
    compressed += chunk.length;
    done(compressed > FORGE_LIMITS.compressedBytes ? new LiveError('limit_exceeded', 'forge_snapshot') : null, chunk);
  } });
  const gunzip = pipeline(Readable.fromWeb(body as never), counter, createGunzip(), () => undefined);
  const take = reader(gunzip as AsyncIterable<Buffer>);
  const files: TransferFile[] = []; const gb1: Record<string, string> = {};
  let top: string | null = null; let extended: Record<string, string> = {}; let longName: string | null = null; let held = 0;
  try {
    for (;;) {
      const header = await take(512, true);
      if (header.every(byte => byte === 0)) break;
      if (!checksum(header)) unstable();
      const type = header[156] === 0 ? '0' : String.fromCharCode(header[156]!);
      let size = octal(header.subarray(124, 136));
      if (type === 'x' || type === 'g' || type === 'L') {
        if (size > META_BYTES) unstable();
        const data = (await take(Math.ceil(size / 512) * 512, true)).subarray(0, size);
        if (type === 'x') extended = pax(data); else if (type === 'L') longName = cstring(data);
        continue;
      }
      const prefix = cstring(header.subarray(345, 500)); const short = cstring(header.subarray(0, 100));
      const name = extended.path ?? longName ?? (prefix ? `${prefix}/${short}` : short);
      if (extended.size !== undefined) size = /^\d+$/.test(extended.size) ? Number(extended.size) : unstable();
      extended = {}; longName = null;
      const padded = Math.ceil(size / 512) * 512; const slash = name.indexOf('/');
      const first = slash < 0 ? name : name.slice(0, slash);
      if (top === null) top = first; else if (first !== top) unstable();
      const path = slash < 0 ? '' : name.slice(slash + 1).replace(/\/+$/, '');
      if (type === '5' || (type === '0' && size === 0 && name.endsWith('/'))) { await take(padded, false); continue; }
      if (!safeDependencyPath(path)) unstable();
      if (excluded(path, subPath)) { await take(padded, false); continue; }
      if (type !== '0' && type !== '7') unstable();
      const inside = subPath === '' || path.startsWith(`${subPath}/`);
      const base = path.slice(path.lastIndexOf('/') + 1);
      const read = path === GB1_QUALIFICATION_PATH || GB1_NAMES.has(base);
      if (!inside && !read) { await take(padded, false); continue; }
      held += size;
      if (size > FORGE_LIMITS.fileBytes || held > FORGE_LIMITS.totalBytes) limit();
      const bytes = (await take(padded, true)).subarray(0, size);
      if (read) gb1[path] = bytes.toString('utf8');
      if (!inside) continue;
      if (files.length >= FORGE_LIMITS.files) limit();
      const mode = octal(header.subarray(100, 108)) & 0o111 ? 0o755 : 0o644;
      files.push({ path: subPath === '' ? path : path.slice(subPath.length + 1), mode, bytes: new Uint8Array(bytes) });
    }
  } catch (error) {
    if (error instanceof LiveError) throw error;
    throw new LiveError('builder_unavailable', 'forge_tarball_error');
  } finally { gunzip.destroy(); }
  return { files: withoutOutput(files, gb1, subPath), gb1 };
}
/** The descriptor's outputDir (relative to `subPath`) is build output: never staged from the branch. */
function withoutOutput(files: TransferFile[], gb1: Record<string, string>, subPath: string) {
  let outputDir: unknown;
  try { outputDir = (JSON.parse(gb1[subPath ? `${subPath}/sentropic.artifact.json` : 'sentropic.artifact.json'] ?? 'null') as
    { outputDir?: unknown } | null)?.outputDir; } catch { return files; }
  if (typeof outputDir !== 'string' || !safeDependencyPath(outputDir.replace(/\/+$/, ''))) return files;
  const root = outputDir.replace(/\/+$/, '');
  return files.filter(file => file.path !== root && !file.path.startsWith(`${root}/`));
}
