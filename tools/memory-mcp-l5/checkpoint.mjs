import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCandidateInput, writeImmutable, verifyCandidateArchive } from './candidate.mjs';
import { sha256 } from './precandidate.mjs';
import { PROOF_CATALOG, checkCheckpoint, computeTupleSha256 } from './receipt.mjs';
import { retainProofBundle } from './proof-bundle.mjs';

/** Produce an evidence proposal, including rejected proposals. Never fill unknown provenance. */
export function produceCheckpoint(root, path, manifestPath, input) {
  const bytes = readCandidateInput(root, manifestPath), manifest = JSON.parse(bytes);
  if (manifest.stage !== 'candidate' || manifest.source.l5Head !== input.binding.sourceHead) throw Error('checkpoint: candidate/source binding mismatch');
  for (const artifact of manifest.artifacts) verifyCandidateArchive(root, artifact);
  const bundle = retainProofBundle(root, dirname(path) + '/r5-proofs', PROOF_CATALOG, input.reports, input.binding);
  const observed = input.observed || {};
  // Missing observed fields stay absent; the closed strict verifier reports them.
  const checkpoint = { ...observed, schemaVersion: 1, checkpoint: 'L5-MEMORY-V1', phase: 'candidate',
    source: { ...observed.source, head: input.binding.sourceHead },
    preCandidate: { ...observed.preCandidate, manifestSha256: manifest.preCandidateManifestSha256,
      contractInventory: manifest.contractInventory, l4BuildReceipt: manifest.l4BuildReceipt },
    artifacts: manifest.artifacts.map(({ archive, ...artifact }) => ({ ...artifact, archiveRef: archive })),
    closure: { ...observed.closure, artifactManifestSha256: sha256(bytes) }, proofs: bundle.proofs };
  checkpoint.tupleSha256 = computeTupleSha256(checkpoint);
  const ref = writeImmutable(root, path, checkpoint, { compact: true });
  const failures = [...bundle.failures, ...checkCheckpoint(checkpoint, { baseDir: root })];
  const result = { checkpoint: ref, accepted: failures.length === 0,
    verdict: failures.length ? 'NOT QUALIFIED' : 'QUALIFIED', failures };
  writeImmutable(root, path + '.validation.json', result, { compact: true });
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), arg = key => args[args.indexOf(key) + 1];
  try {
    if (!['--inputs', '--manifest', '--checkpoint'].every(key => args.includes(key))) throw Error('checkpoint: --inputs, --manifest and --checkpoint required');
    const root = process.cwd(), input = JSON.parse(readCandidateInput(root, arg('--inputs')));
    const result = produceCheckpoint(root, arg('--checkpoint'), arg('--manifest'), input);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.accepted ? 0 : 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
