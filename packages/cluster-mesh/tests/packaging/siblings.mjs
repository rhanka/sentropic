// Same-PR sibling archives for the packed qualification (release-train design section 2c).
// Runs inside the packaging container only (packaging.mk -> prepare.sh); never on the host.
//   verify <receipts.json> <dest-dir>   validate the receipts with scripts/ci/qualify-published-install.mjs
//                                       loadSiblings itself (head sha = CLUSTER_MESH_HEAD_SHA, pinned semver from
//                                       MANIFEST_GUARD_TOOL_DIR), copy each archive to <dest-dir>, write index.json
//   spec <dest-dir> <name> <version>    print `file:<archive>` when a verified sibling is exactly name@version,
//                                       else the plain registry version
//   candidate <dest-dir> <name> <version>
//                                       print the verified archive of the candidate itself, nothing without a
//                                       receipt for <name>; a receipt for another version fails
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadSiblings } from '../../../../scripts/ci/qualify-published-install.mjs';

const fail = (message) => {
  console.error(`sibling archives: ${message}`);
  process.exit(1);
};

const digest = (algorithm, bytes, encoding) => createHash(algorithm).update(bytes).digest(encoding);
export const sri512 = (bytes) => `sha512-${digest('sha512', bytes, 'base64')}`;

function verify(receiptsPath, dest) {
  if (path.basename(receiptsPath) !== 'receipts.json') fail(`${receiptsPath} is not a receipts.json file`);
  const headSha = process.env.CLUSTER_MESH_HEAD_SHA;
  if (!headSha) fail('CLUSTER_MESH_HEAD_SHA is required: sibling receipts must be packed from the current commit');
  let siblings;
  try {
    siblings = loadSiblings(path.dirname(receiptsPath), { headSha });
  } catch (error) {
    fail(error.message);
  }
  const basenames = new Map();
  for (const sibling of siblings) {
    const base = path.basename(sibling.file);
    if (basenames.has(base)) fail(`archive basename ${base} collides: ${basenames.get(base)} and ${sibling.name}@${sibling.version}`);
    basenames.set(base, `${sibling.name}@${sibling.version}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  const index = siblings.map((sibling) => {
    const bytes = fs.readFileSync(sibling.file);
    const file = path.join(dest, path.basename(sibling.file));
    fs.writeFileSync(file, bytes);
    return { name: sibling.name, version: sibling.version, file, sha256: sibling.sha256, integrity: sri512(bytes), head_sha: headSha };
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

function candidate(dest, name, version) {
  const hits = readIndex(dest).filter((entry) => entry.name === name);
  const other = hits.find((entry) => entry.version !== version);
  if (other) fail(`receipt carries ${name}@${other.version}, the candidate is ${version}`);
  if (hits.length) console.log(hits[0].file);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'verify' && args.length === 2) verify(args[0], args[1]);
  else if (command === 'spec' && args.length === 3) spec(args[0], args[1], args[2]);
  else if (command === 'candidate' && args.length === 3) candidate(args[0], args[1], args[2]);
  else fail('usage: siblings.mjs verify <receipts.json> <dest-dir> | spec|candidate <dest-dir> <name> <version>');
}
