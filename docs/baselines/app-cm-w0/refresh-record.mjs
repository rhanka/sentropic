import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const directory = '/workspace/docs/baselines/app-cm-w0/';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const save = (name, data) => writeFileSync(directory + name, JSON.stringify(data) + '\n');
const fit = json('/out/probe-result.json');
const payload = json('/out/payload-equivalence.json');
const lock = json('/out/workspace-package-lock.json');
assert.equal(sha256('/out/workspace-package-lock.json'), sha256('/workspace/package-lock.json'));
assert.equal(fit.manifestDigest, '80ca4b067a010690dc71036a3237a70b91d99d7c025ded7173566d0ae55b1600');
const tree = json('/out/workspace-tree.json');
const runtime = json('/out/workspace-runtime-tree.json');
assert.equal(runtime.problems, undefined);
save('published-fit-2026-10-27.json', fit);
save('payload-equivalence-2026-10-27.json', payload);
save('workspace-resolved-2026-10-27.json', { packages: lock.packages, installed: tree, runtime });
save('registry-results-2026-10-27.json', Object.fromEntries(['red', 'green'].map(state =>
  [state, readFileSync(`/out/registry-${state}.log`, 'utf8').replace(/\u001b\[[0-9;]*m/g, '')])));
const packages = Object.fromEntries(Object.entries(payload.receipts).map(([name, receipt]) =>
  [name, { ...receipt.metadata, archiveSha256: receipt.archiveSha256 }]));
const inputs = ['package.json', 'package-lock.json', 'api/package.json', 'api/package-lock.json',
  'api/src/services/mcp/cluster-registry.ts', 'api/tests/api/app-mcp-registry.test.ts',
  'api/tests/api/app-mcp-installed.test.ts'];
const tuple = {
  observedAt: fit.observedAt,
  status: 'published-qualified-workspace-source-not-app-deployed',
  sourceSha: process.env.W0_REFRESH_SOURCE_SHA,
  bases: { w2b: 'd0ce8aeb0', w0: '5dfab2cf3', mainUpT: '72bb2da3d',
    mergedSource: '2c3bf7750c0d9e13372bb573cc4fb5fc0b4a86cc', mode: 'merge-commits' },
  historicalEvidence: ['published-tuple-2026-10-18.json', 'published-tuple-2026-10-26.json'],
  packages,
  selectedPeers: Object.fromEntries(Object.entries(fit.resolvedTree)
    .filter(([path]) => /^node_modules\/(@sentropic\/|@modelcontextprotocol\/sdk$|hono$|jose$|pg$|@aws-sdk\/client-s3$)/.test(path))
    .map(([path, entry]) => [path, entry])),
  profile: { id: 'APP-P1', capabilities: fit.manifest.tools.map(t => t.name),
    invocationScope: 'mcp:tools:invoke', compiledDigest: fit.profileDigest, manifestDigest: fit.manifestDigest,
    frozenContractSha256: '4e16117a38f8ff46a80f621667d0ac4baf020f82a384050a6dc2d2ab20a61854' },
  publishedFit: { receipt: 'published-fit-2026-10-27.json', strictPeers: true, sourceLinks: 0,
    upstreamBumpNeeded: false, lockSha256: fit.lockSha256, applicationQualification: false },
  payloadEquivalence: { receipt: 'payload-equivalence-2026-10-27.json', procedure: 'tuple-refresh-2026-10-27.md',
    exactPayloads: ['artifacts', 'llm-mesh'],
    declarationUnionOrderOnly: ['cluster-mesh/dist/storage/root-facade.d.ts', 'llm-gateway/dist/request-receipts.d.ts'],
    productionImageQualified: false },
  workspaceResolution: { mode: 'workspace-source', strictInstall: true, lockfileVersion: lock.lockfileVersion,
    entryCount: Object.keys(lock.packages).length, completeTree: 'workspace-resolved-2026-10-27.json',
    completeTreeSha256: sha256(directory + 'workspace-resolved-2026-10-27.json'),
    lockSha256: sha256('/workspace/package-lock.json'), lockGitBlob: process.env.W0_REFRESH_LOCK_BLOB,
    apiLockSha256: sha256('/workspace/api/package-lock.json'), apiLockGitBlob: process.env.W0_REFRESH_API_LOCK_BLOB,
    runtimeProblems: [], developmentProblems: tree.problems ?? [],
    tools: readFileSync('/out/workspace-tools.txt', 'utf8').trim().split('\n') },
  sourceInputs: Object.fromEntries(inputs.map(path => [path, sha256('/workspace/' + path)])),
  receivingGates: { productionImage: 'W3', integratedAcceptance: 'W5', activation: 'default-closed' },
};
assert.match(tuple.sourceSha, /^[a-f0-9]{40}$/);
writeFileSync(directory + 'published-tuple.json', '{\n' + Object.entries(tuple)
  .map(([key, value]) => JSON.stringify(key) + ':' + JSON.stringify(value)).join(',\n') + '\n}\n');
