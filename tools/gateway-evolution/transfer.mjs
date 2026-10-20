import * as fs from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createCandidateBundle, safePath } from './bundle.mjs';
import { inspectArchive } from './archive.mjs';
import { assertNoDuplicateKeys, GatewayInputError } from './run.mjs';
const fail = (message, code) => { throw new GatewayInputError(message, code); };
export const readConfined = async (root, path) => {
  safePath(path);
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    if ((await fs.lstat(cursor)).isSymbolicLink()) fail('symlink in artifact path', 'unsafe-member');
  }
  if (!(await fs.lstat(cursor)).isFile()) fail('regular artifact required', 'unsafe-member');
  return fs.readFile(cursor);
};
export const transferCandidate = async ({ manifestPath, worktree, program, delivery, mode, sourceSha }) => {
  const absolute = resolve(manifestPath);
  const text = (await readConfined(dirname(absolute), absolute.split('/').at(-1))).toString();
  assertNoDuplicateKeys(text);
  const manifest = JSON.parse(text);
  if (manifest.sourceSha !== sourceSha) fail('pack source differs from current HEAD', 'bad-source');
  const files = new Map();
  for (const artifact of manifest.artifacts ?? []) {
    const bytes = await readConfined(dirname(absolute), artifact.path);
    files.set(artifact.path, bytes);
    if (artifact.path.endsWith('.tgz')) {
      const packed = inspectArchive(bytes);
      const digest = createHash('sha256').update(bytes).digest('hex');
      const identity = manifest.packages.find((row) => row.tarballSha256 === digest);
      if (!identity || identity.name !== packed.name || identity.version !== packed.version
        || identity.integrity !== `sha512-${createHash('sha512').update(bytes).digest('base64')}`) fail('packed package identity mismatch', 'tuple-mismatch');
    }
  }
  if (![...files.keys()].some((p) => /^receipts\/[^/]+\/receipts\.json$/.test(p))) fail('namespaced sibling receipts required', 'bad-manifest');
  for (const row of manifest.packages ?? []) {
    if (row.sourceIdentity.startsWith('candidate:') && !manifest.artifacts.some((a) => a.path.endsWith('.tgz') && a.sha256 === row.tarballSha256)) fail('same-PR sibling missing', 'tuple-mismatch');
  }
  const bundle = createCandidateBundle({ program, delivery, mode, manifest, files });
  const github = join(worktree, '.github');
  if ((await fs.lstat(github)).isSymbolicLink()) fail('linked destination refused', 'unsafe-member');
  const root = join(worktree, bundle.input.candidateBundle.root);
  // Every pre-existing parent must be a real directory, never a link.
  let cursor = worktree;
  for (const part of bundle.input.candidateBundle.root.split('/').filter(Boolean)) {
    cursor = join(cursor, part);
    const existing = await fs.lstat(cursor).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) fail('unsafe destination', 'unsafe-member');
  }
  try {
    await fs.lstat(root);
    fail('bundle destination already exists; review committed bytes', 'dirty-destination');
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  await fs.mkdir(root, { recursive: true });
  try {
    for (const [path, bytes] of bundle.files) {
      const target = join(root, path);
      await fs.mkdir(dirname(target), { recursive: true });
      await fs.writeFile(target, bytes, { flag: 'wx' });
    }
    const temporary = join(github, `gateway-consumer-input.${process.pid}.tmp`);
    await fs.writeFile(temporary, `${JSON.stringify(bundle.input, null, 2)}\n`, { flag: 'wx' });
    await fs.rename(temporary, join(github, 'gateway-consumer-input.json'));
  } catch (e) {
    await fs.rm(root, { recursive: true, force: true });
    throw e;
  }
  return { root: bundle.input.candidateBundle.root, totalBytes: bundle.totalBytes, largestBlob: bundle.largestBlob, bundleSha256: bundle.input.candidateBundle.bundleSha256 };
};
