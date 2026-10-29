import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANCILLARY, readInside, sha256, integrity } from './precandidate.mjs';
import { readArchive } from './contract-graph.mjs';
import { checkArtifactManifest, isCommitSha } from './receipt.mjs';
import { verifyRetainedP3 } from './lot2-retained.mjs';

const inside = (root, path) => {
  const base = realpathSync(root), full = realpathSync(resolve(root, path));
  if (!full.startsWith(base + '/')) throw Error('candidate: input outside root');
  return readInside(root, path);
};
export { inside as readCandidateInput };

export function verifyCandidateArchive(root, artifact) {
  const bytes = inside(root, artifact.archive);
  if (sha256(bytes) !== artifact.sha256 || integrity(bytes) !== artifact.integrity) {
    throw Error(`candidate: archive digest mismatch: ${artifact.name}`);
  }
  const files = readArchive(bytes), pkg = JSON.parse(files.get('package.json'));
  if (pkg.name !== artifact.name || pkg.version !== artifact.version || !isCommitSha(artifact.sourceHead)) {
    throw Error(`candidate: archive identity mismatch: ${artifact.name}`);
  }
  return { artifact, files, pkg };
}

/** Assemble verified bytes, never substitute current sources for frozen peers. */
export function assembleCandidate(root, prePath, inputs, head) {
  if (!isCommitSha(head)) throw Error('candidate: exact l5 head required');
  verifyRetainedP3(root, prePath);
  const preBytes = inside(root, prePath), pre = JSON.parse(preBytes);
  const receiptBytes = inside(root, inputs.l4BuildReceipt.path);
  if (sha256(receiptBytes) !== inputs.l4BuildReceipt.sha256) throw Error('candidate: build receipt digest mismatch');
  const receipt = JSON.parse(receiptBytes);
  const artifacts = [...pre.artifacts, ...inputs.artifacts];
  const l4 = artifacts.find(a => a.role === 'l4');
  if (!l4 || receipt.builtAgainstPreCandidateSha256 !== sha256(preBytes) ||
      receipt.e4ArtifactSha256 !== l4.sha256 || receipt.sourceHead !== l4.sourceHead) {
    throw Error('candidate: E4 build receipt/P3/archive binding mismatch');
  }
  const manifest = { manifestVersion: 1, stage: 'candidate', preCandidateManifestSha256: sha256(preBytes),
    e4ArtifactSha256: l4.sha256, l4BuildReceipt: inputs.l4BuildReceipt,
    source: { ...pre.source, l5Head: head }, artifacts, contractInventory: pre.contractInventory };
  const failures = checkArtifactManifest(manifest, { retainedContractInventory: pre.contractInventory });
  if (failures.length) throw Error(failures.join('\n'));
  const verified = artifacts.map(a => verifyCandidateArchive(root, a));
  for (const item of pre.contractInventory) {
    const match = /^packages\/([^/]+)\/(.+)$/.exec(item.path);
    const pkg = match && verified.find(v => v.artifact.name === `@sentropic/${match[1]}`);
    const bytes = pkg && !ANCILLARY.includes(item.path) ? pkg.files.get(match[2]) : inside(root, item.path);
    if (!bytes || sha256(bytes) !== item.sha256) throw Error(`candidate: changed/missing contract: ${item.path}`);
  }
  return manifest;
}

export function writeImmutable(root, path, doc, { compact = false } = {}) {
  // Validate the output path with the same confined reader as artifact inputs.
  const bytes = Buffer.from(JSON.stringify(doc, null, compact ? 0 : 2) + '\n');
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + '/')) throw Error('candidate: output outside root');
  let ancestor = dirname(target);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  if (realpathSync(ancestor) !== realpathSync(root) && !realpathSync(ancestor).startsWith(realpathSync(root) + '/')) throw Error('candidate: output symlink escapes root');
  mkdirSync(dirname(target), { recursive: true });
  if (existsSync(target)) {
    if (!inside(root, path).equals(bytes)) throw Error('candidate: immutable output already exists with different bytes');
  } else {
    writeFileSync(target, bytes, { flag: 'wx' });
  }
  const sidecar = path + '.sha256', sidecarBytes = Buffer.from(sha256(bytes) + '\n');
  if (existsSync(resolve(root, sidecar))) {
    if (!inside(root, sidecar).equals(sidecarBytes)) throw Error('candidate: sidecar mismatch');
  } else writeFileSync(resolve(root, sidecar), sidecarBytes, { flag: 'wx' });
  return { path, sha256: sha256(bytes) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2), arg = name => argv[argv.indexOf(name) + 1];
  try {
    const root = process.cwd(), input = arg('--inputs');
    if (!argv.includes('--inputs') || !argv.includes('--head') || !argv.includes('--manifest')) throw Error('candidate: --inputs, --head and --manifest required');
    const manifest = assembleCandidate(root, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json',
      JSON.parse(inside(root, input)), arg('--head'));
    console.log(JSON.stringify({ ...writeImmutable(root, arg('--manifest'), manifest, { compact: true }), qualificationAccepted: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
