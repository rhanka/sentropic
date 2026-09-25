// Same-PR sibling archives for the packed qualification (release-train design section 2c).
// Runs inside the packaging container only (packaging.mk -> prepare.sh); never on the host.
//   verify <receipts.json> <dest-dir>   validate every receipt as scripts/ci/qualify-published-install.mjs
//                                       loadSiblings does, copy each archive to <dest-dir> and write index.json
//   spec <dest-dir> <name> <version>    print `file:<archive>` when a verified sibling is exactly name@version,
//                                       else the plain registry version
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const fail = (message) => {
  console.error(`sibling archives: ${message}`);
  process.exit(1);
};

/** Read package/package.json from an npm pack archive (ustar, gzip). */
export function packedManifest(bytes) {
  const tar = gunzipSync(bytes);
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, end) => header.subarray(start, end).toString('utf8').replace(/\0.*$/su, '');
    const name = [field(345, 500), field(0, 100)].filter(Boolean).join('/');
    const size = Number.parseInt(field(124, 136).trim() || '0', 8);
    const body = offset + 512;
    if (name === 'package/package.json') return JSON.parse(tar.subarray(body, body + size).toString('utf8'));
    offset = body + Math.ceil(size / 512) * 512;
  }
  throw new Error('archive has no package/package.json');
}

const digest = (algorithm, bytes, encoding) => createHash(algorithm).update(bytes).digest(encoding);
export const sha256 = (bytes) => digest('sha256', bytes, 'hex');
export const sri512 = (bytes) => `sha512-${digest('sha512', bytes, 'base64')}`;

function verify(receiptsPath, dest) {
  const dir = path.dirname(receiptsPath);
  let receipts;
  try {
    receipts = JSON.parse(fs.readFileSync(receiptsPath, 'utf8'));
  } catch (error) {
    fail(`unreadable receipts ${receiptsPath}: ${error.message}`);
  }
  if (!Array.isArray(receipts)) fail('receipts must be a JSON array');
  fs.mkdirSync(dest, { recursive: true });
  const index = receipts.map((r) => {
    if (r?.guard !== 'pass' || r?.manifest_mode !== 'block' || r?.evidence !== 'release-candidate') {
      fail(`receipt for ${r?.name} is not a passing BLOCK release-candidate guard receipt`);
    }
    if (typeof r.file !== 'string' || r.file.includes('..') || path.isAbsolute(r.file)) fail(`invalid archive path ${r.file}`);
    const source = path.join(dir, r.file);
    if (!fs.lstatSync(source, { throwIfNoEntry: false })?.isFile()) fail(`archive missing or not a regular file: ${r.file}`);
    const bytes = fs.readFileSync(source);
    if (sha256(bytes) !== r.sha256) fail(`archive hash mismatch for ${r.name}@${r.version}`);
    const manifest = packedManifest(bytes);
    if (manifest.name !== r.name || manifest.version !== r.version) {
      fail(`identity mismatch: receipt ${r.name}@${r.version}, packed ${manifest.name}@${manifest.version}`);
    }
    const file = path.join(dest, path.basename(r.file));
    fs.writeFileSync(file, bytes);
    return { name: r.name, version: r.version, file, sha256: r.sha256, integrity: sri512(bytes), head_sha: r.head_sha ?? null };
  });
  fs.writeFileSync(path.join(dest, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  for (const entry of index) console.log(`[siblings] ${entry.name}@${entry.version} sha256=${entry.sha256}`);
}

export function readIndex(dest) {
  const file = path.join(dest, 'index.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}

function spec(dest, name, version) {
  const hit = readIndex(dest).find((entry) => entry.name === name && entry.version === version);
  console.log(hit ? `file:${hit.file}` : version);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'verify' && args.length === 2) verify(args[0], args[1]);
  else if (command === 'spec' && args.length === 3) spec(args[0], args[1], args[2]);
  else fail('usage: siblings.mjs verify <receipts.json> <dest-dir> | spec <dest-dir> <name> <version>');
}
