import { cpSync, existsSync, readFileSync } from 'node:fs';
import { sha256 } from './precandidate.mjs';
import { writeImmutable, readCandidateInput } from './candidate.mjs';
import { resolvePredecessors } from './predecessors.mjs';
import { PROOF_CATALOG } from './receipt.mjs';
const root = process.cwd(), out = 'spec/evidence/memory-mcp-l5/r5-run';
const manifestBytes = readCandidateInput(root, process.env.ARTIFACT_MANIFEST), manifest = JSON.parse(manifestBytes);
const json = path => JSON.parse(readCandidateInput(root, path));
const ref = path => ({ path, sha256: sha256(readCandidateInput(root, path)) });
const sourceHead = process.env.MEMORY_L5_SOURCE_HEAD;
if (sourceHead !== manifest.source.l5Head) throw Error('collect: source head differs from candidate');
const reports = [];
for (const pkg of ['mcp-platform', 'cluster-mesh', 'mcp-broker']) {
  const from = `tmp/memory-l5-lot3-results/${pkg}.json`, to = `${out}/${pkg}.json`;
  if (existsSync(from)) { cpSync(from, to, { force: false, errorOnExist: true }); reports.push(to); }
}
if (existsSync(`${out}/tooling.json`)) reports.push(`${out}/tooling.json`);
for (const name of ['exports', 'disabled-install', 'identity-source-refusal', 'sdk-discovery-call', 'restart-lost-response', 'confirmation-step-up']) {
  const path = `${out}/packed-${name}.json`;
  if (existsSync(path)) reports.push(path);
}
const pre = json('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json');
const contracts = { specSha256: pre.source.specSha256, l0Commit: pre.source.l0Commit,
  l0Freeze: ref('spec/evidence/memory-mcp-l5/l0-freeze.json') };
const optionalDigest = (object, key, path) => { if (existsSync(path)) object[key] = ref(path).sha256; };
optionalDigest(contracts, 'registrySha256', 'packages/mcp-platform/dist/registry.d.ts');
optionalDigest(contracts, 'gatewaySha256', 'packages/cluster-mesh/dist/compose/mcp.d.ts');
const assurance = { qualificationOnly: true };
optionalDigest(assurance, 'productionPolicySha256', 'tools/memory-mcp-l5/policies/production-v1.json');
optionalDigest(assurance, 'qualificationPolicySha256', 'tools/memory-mcp-l5/policies/qualification-v1.json');
optionalDigest(assurance, 'verifierArtifactSha256', 'tools/memory-mcp-l5/verifier.mjs');
const observed = { source: { repository: 'rhanka/sentropic', head: sourceHead,
  base: process.env.MEMORY_L5_BASE, checkout: sourceHead }, contracts, assurance,
  closure: { sdkRange: pre.source.sdkRange, declaredLockSha256: pre.source.declaredLockSha256,
    referenceExport: '@sentropic/mcp-broker/memory-reference' } };
const { binding } = json(`${out}/execution-context.json`);
if (binding.sourceHead !== sourceHead || binding.artifactManifestSha256 !== sha256(manifestBytes)) throw Error('collect: execution context mismatch');
// The executor retained raw bytes and bound them during the actual launch.
writeImmutable(root, `${out}/checkpoint-inputs.json`, { binding, reports, observed });
writeImmutable(root, `${out}/predecessors.json`, resolvePredecessors(root, PROOF_CATALOG));
writeImmutable(root, `${out}/availability.json`, PROOF_CATALOG.proofs.map(p => ({ id: p.id,
  missing: p.files.filter(path => !existsSync(path)), requiredCases: p.requiredCases })));
console.log(JSON.stringify({ reports: reports.map(ref), sourceHead, qualificationAccepted: false }));
