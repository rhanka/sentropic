import { gunzipSync } from 'node:zlib';
import { GatewayInputError } from './run.mjs';
const refuse = () => { throw new GatewayInputError('unsafe or invalid package archive', 'unsafe-archive'); };
const stringAt = (block, start, end) => block.subarray(start, end).toString().split('\0')[0];
const octalAt = (block, start, end) => {
  const text = stringAt(block, start, end).trim();
  if (!/^[0-7]+$/.test(text)) refuse();
  return parseInt(text, 8);
};
const confined = (path) => {
  const parts = path.replace(/\/$/, '').split('/');
  if (parts[0] !== 'package' || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes(':'))) refuse();
  if (parts.some((p) => /^\.env($|\.(?!example$))/.test(p) || ['credentials', 'node_modules', '.github', '.tmp'].includes(p))) refuse();
  return path;
};
/** Inspect real archive members before npm sees them; bounded decompression. */
export const inspectArchive = (bytes) => {
  let tar;
  try { tar = gunzipSync(bytes, { maxOutputLength: 128 * 1024 * 1024 }); } catch { refuse(); }
  const seen = new Set();
  let manifest;
  let paxPath;
  let offset = 0;
  for (; offset + 512 <= tar.length;) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((b) => b === 0)) break;
    const checksum = block.reduce((sum, b, i) => sum + (i >= 148 && i < 156 ? 32 : b), 0);
    if (octalAt(block, 148, 156) !== checksum) refuse();
    const size = octalAt(block, 124, 136);
    const type = stringAt(block, 156, 157) || '0';
    const prefix = stringAt(block, 345, 500);
    const headerPath = `${prefix ? `${prefix}/` : ''}${stringAt(block, 0, 100)}`;
    const start = offset + 512;
    if (start + size > tar.length) refuse();
    const data = tar.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      let pos = 0;
      while (pos < data.length) {
        const space = data.indexOf(32, pos);
        const length = Number(data.subarray(pos, space).toString());
        if (space < 0 || !Number.isSafeInteger(length) || length <= space - pos || pos + length > data.length) refuse();
        const record = data.subarray(space + 1, pos + length - 1).toString();
        const equals = record.indexOf('=');
        if (equals < 1 || record.startsWith('linkpath=')) refuse();
        if (record.startsWith('path=')) paxPath = record.slice(5);
        pos += length;
      }
      continue;
    }
    if (!['0', '5'].includes(type)) refuse();
    const path = confined(paxPath ?? headerPath);
    paxPath = undefined;
    if (seen.has(path)) refuse();
    seen.add(path);
    if (path === 'package/package.json') {
      try { manifest = JSON.parse(data.toString()); } catch { refuse(); }
    }
  }
  if (!manifest || paxPath || offset + 1024 > tar.length || tar.subarray(offset).some((b) => b !== 0)) refuse();
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string' || manifest.private === true) refuse();
  return manifest;
};
