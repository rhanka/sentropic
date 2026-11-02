import { digest } from '../daily/toolchain-contract.mjs';
import { requireContract as check, record, timestamp, equal, measured, CONTRACT_ONLY } from './contract-schema.mjs';
import { validateMaterialContract } from './material-contract.mjs';
import { receiptSchemas } from './receipt-schema.mjs';

const jsonDigest = value => digest(JSON.stringify(value));
const readJson = bytes => {
  try { return JSON.parse(bytes); } catch { check(false, 'output JSON'); }
};
const sameDescriptor = (a, b) => a?.digest === b.digest && a?.size === b.size;

// Contract validation is not platform authentication, signature verification,
// content admission, archive extraction or authority to build/publish/execute.
export function validateReceiptContract({ materials, receipts, artifactBytes, outputs, now } = {}) {
  validateMaterialContract(materials);
  check(record(receiptSchemas)(receipts), 'receipt schemas');
  check(timestamp(now), 'observation time');
  const { build, validation, publication } = receipts;
  const recipe = JSON.parse(materials.recipeBytes);
  for (const receipt of Object.values(receipts)) {
    check(receipt.startedAt <= receipt.finishedAt && receipt.finishedAt <= now, 'receipt interval');
    for (const key of ['repository', 'repositoryId', 'head', 'base', 'tree', 'sourceCommit', 'workflow',
      'controlDigest', 'policyDigest', 'schemaDigest', 'materialDigest', 'recipeDigest', 'runId', 'attempt', 'artifact', 'chain']) {
      check(equal(receipt[key], build[key]), `same-artifact receipt ${key}`);
    }
  }
  check(build.sourceCommit === recipe.sourceCommit && equal(build.upstream, recipe.upstream), 'source binding');
  check(build.materialDigest === jsonDigest(materials.manifest) && build.recipeDigest === materials.manifest.recipeDigest,
    'material/recipe binding');
  check(equal(build.patchDigests, materials.manifest.materials.filter(m => m.kind === 'patch').map(m => m.digest)), 'patch order');
  check(build.toolsDigest === jsonDigest({ go: recipe.go, base: recipe.base, tools: recipe.tools, actions: recipe.actions }), 'tool pins');
  check(validation.buildReceiptDigest === jsonDigest(build) && publication.buildReceiptDigest === jsonDigest(build) &&
    publication.validationReceiptDigest === jsonDigest(validation), 'receipt digest chain');
  check(validation.expiresAt > now && validation.expiresAt > validation.finishedAt, 'validation expiry');
  check(equal(build.reproducibility.first, build.reproducibility.second) &&
    build.reproducibility.first.binaryDigest === build.chain.binary.digest, 'normalized reproducibility');
  const { artifact, chain } = build;
  check(Buffer.isBuffer(artifactBytes) && artifactBytes.length > 0 && artifactBytes.length === artifact.size &&
    digest(artifactBytes) === artifact.digest, 'artifact bytes');
  const entries = [chain.index, chain.manifest, chain.config, ...chain.layers, chain.binary, chain.sbom];
  check(new Set(entries.map(e => e.path)).size === entries.length && equal(artifact.files, entries), 'artifact file manifest');
  check(outputs && equal(Object.keys(outputs).sort(), entries.map(e => e.path).sort()), 'complete outputs');
  entries.forEach(entry => measured(entry, outputs));
  const index = readJson(outputs[chain.index.path]);
  const matches = index.manifests?.filter(m => m.platform?.os === 'linux' && m.platform?.architecture === 'amd64');
  check(matches?.length === 1 && sameDescriptor(matches[0], chain.manifest), 'index/platform linkage');
  const manifest = readJson(outputs[chain.manifest.path]);
  check(sameDescriptor(manifest.config, chain.config) && Array.isArray(manifest.layers) &&
    manifest.layers.length === chain.layers.length && manifest.layers.every((l, i) => sameDescriptor(l, chain.layers[i])), 'config/layer linkage');
  const config = readJson(outputs[chain.config.path]);
  check(config.os === 'linux' && config.architecture === 'amd64', 'config platform');
  check(publication.registryReadbackDigest === chain.index.digest && publication.anonymousPullDigest === chain.index.digest, 'registry read-back');
  check(publication.signing.workflowCommit === build.workflow.commit && publication.signing.sourceCommit === build.sourceCommit &&
    publication.signing.signedAt >= publication.startedAt && publication.signing.signedAt <= publication.finishedAt, 'signing claims');
  check(publication.resources.bytes === artifact.size && publication.resources.storageBytes >= artifact.size, 'resource accounting');
  return CONTRACT_ONLY;
}
