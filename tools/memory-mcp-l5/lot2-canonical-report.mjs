// Completeness/binding guard only. Authenticated CI/co-owner acceptance remains a checkpoint duty.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { receiveLot2Manifest } from './lot2-manifest.mjs';
import { readInside } from './precandidate.mjs';
import { sha256Hex } from './schema-validator.mjs';
const REQUIRED = ['P05.e2.canonical-fenced-store', 'P06.e2.before-claim', 'P06.e2.before-canonical-commit',
  'P06.e2.after-commit-before-workflow-completion', 'P06.e2.after-completion-before-response'];
export function checkLot2CanonicalReport(binding, result, expected = {}) {
  const errors = [];
  const keys = ['phase', 'artifactManifestSha256', 'e2ArtifactSha256', 'referenceArtifactSha256', 'sourceHead'];
  if (!binding || Object.keys(binding).sort().join() !== [...keys].sort().join() ||
      binding.phase !== 'e2' || keys.some(key => binding[key] !== expected[key])) errors.push('canonical report: tuple binding mismatch');
  const files = Array.isArray(result?.testResults) ? result.testResults : [];
  const assertions = files.flatMap(file => Array.isArray(file?.assertionResults) ? file.assertionResults : []);
  if (result?.success !== true || result.numFailedTests !== 0 || result.numPendingTests !== 0 || result.numTodoTests !== 0 ||
      !assertions.length || result.numPassedTests !== assertions.length || assertions.some(a => a?.status !== 'passed') ||
      files.some(file => !file?.assertionResults?.length)) errors.push('canonical report: failed/skipped/todo or incomplete results');
  for (const id of REQUIRED) {
    if (!assertions.some(a => a?.status === 'passed' && String(a.fullName ?? a.title ?? '').split(/[ :]+/).includes(id))) errors.push(`canonical report: missing ${id}`);
  }
  return errors;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const root = process.cwd(), { manifest, manifestSha256 } = receiveLot2Manifest(process.argv[2], root);
    const receipt = JSON.parse(readInside(root, process.argv[3]));
    const reference = manifest.artifacts.find(a => a.role === 'broker');
    if (reference?.version !== '0.2.0') throw Error('canonical report: current reference archive required');
    const file = realpathSync(resolve(root, receipt.result.path)), rel = relative(realpathSync(root), file);
    if (rel.startsWith('..') || rel.startsWith('/')) throw Error('canonical report: unsafe result path');
    const bytes = readFileSync(file);
    if (sha256Hex(bytes) !== receipt.result.sha256) throw Error('canonical report: result sha256 mismatch');
    const expected = { phase: 'e2', artifactManifestSha256: manifestSha256, e2ArtifactSha256: manifest.e2ArtifactSha256,
      referenceArtifactSha256: reference.sha256, sourceHead: process.argv[4] };
    const errors = checkLot2CanonicalReport(receipt.binding, JSON.parse(bytes), expected);
    if (errors.length) throw Error(errors.join('\n'));
    console.log(JSON.stringify({ completeCanonicalCases: REQUIRED, checkpointAccepted: false }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
