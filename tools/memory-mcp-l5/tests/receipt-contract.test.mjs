import { existsSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, it, expect } from 'vitest';
import {
  PROOF_CATALOG,
  PROOF_IDS,
  ACCEPTANCE_ROLES,
  FROZEN_SPEC_SHA256,
  sha256OfBytes,
  sha512Integrity,
  computeTupleSha256,
  checkCheckpoint,
} from '../receipt.mjs';
import { canonicalizeJson } from '../schema-validator.mjs';
import { computeLockFingerprint } from '../lock-fingerprint.mjs';

const SYNTH_MAKEFILE = [
  'MEMORY_L5_NODE_IMAGE := node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6',
  'export LLM_MESH_NODE_IMAGE ?= node:24-bookworm-slim',
  'memory-l5-pack: export LLM_MESH_NODE_IMAGE = $(MEMORY_L5_NODE_IMAGE)',
  'build-mcp-platform:',
  '\t@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-platform $(LLM_MESH_NODE_IMAGE) sh -lc \'rm -rf dist node_modules\'',
  '\t@docker run --rm -u "$$(id -u):$$(id -g)" -e HOME=/tmp -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-platform $(LLM_MESH_NODE_IMAGE) sh -lc \'set -eu; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node@22.20.1 >/dev/null; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json\'',
  'build-mcp-broker:',
  '\t@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-broker $(LLM_MESH_NODE_IMAGE) sh -lc \'set -eu; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node@22.20.1 >/dev/null; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json\'',
  'api-extract-mcp-platform:',
  '\t@docker run --rm -v "$(CURDIR):/workspace" -w /workspace/packages/mcp-platform $(LLM_MESH_NODE_IMAGE) sh -lc \'set -eu; npm_config_cache=/tmp/npm-cache npm install --prefix "$$tool_dir" --no-save --no-audit --no-fund typescript@5.4.5 @types/node@22.20.1 @microsoft/api-extractor@7.58.9 >/dev/null; "$$tool_dir/node_modules/.bin/tsc" -p tsconfig.json; "$$tool_dir/node_modules/.bin/api-extractor" run\'',
].join('\n');

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'schemas', 'checkpoint-v1.schema.json');
const MANIFEST_SCHEMA_PATH = join(HERE, '..', 'schemas', 'artifact-manifest-v1.schema.json');
const CATALOG_PATH = join(HERE, '..', 'proof-catalog-v1.json');
const RECEIPT_BIN = join(HERE, '..', 'receipt.mjs');

const H64 = 'a'.repeat(64);
const C40 = 'b'.repeat(40);
const PINNED_IMAGE = 'node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6';

function writeRef(baseDir, relPath, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  const abs = join(baseDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return { path: relPath, bytes, sha256: sha256OfBytes(bytes), integrity: sha512Integrity(bytes) };
}

function makeTarGz(entries) {
  const blocks = [];
  for (const [name, content] of entries) {
    const data = Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
    const hdr = Buffer.alloc(512);
    hdr.write(name, 0, 100, 'utf8');
    hdr.write('0000644\0', 100, 8, 'ascii');
    hdr.write('0000000\0', 108, 8, 'ascii');
    hdr.write('0000000\0', 116, 8, 'ascii');
    hdr.write(`${data.length.toString(8).padStart(11, '0')}\0`, 124, 12, 'ascii');
    hdr.write('00000000000\0', 136, 12, 'ascii');
    hdr.write('        ', 148, 8, 'ascii');
    hdr[156] = 48;
    hdr.write('ustar\0', 257, 6, 'ascii');
    hdr.write('00', 263, 2, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += hdr[i];
    hdr.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
    blocks.push(hdr, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function buildCheckpointBundle(baseDir) {
  const ev = writeRef(baseDir, 'spec/evidence/memory-mcp-l5/item.json', { ok: true });
  const cpSchemaRef = writeRef(baseDir, 'tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json', readFileSync(SCHEMA_PATH));
  const mfSchemaRef = writeRef(baseDir, 'tools/memory-mcp-l5/schemas/artifact-manifest-v1.schema.json', readFileSync(MANIFEST_SCHEMA_PATH));
  const catFileRef = writeRef(baseDir, 'tools/memory-mcp-l5/proof-catalog-v1.json', readFileSync(CATALOG_PATH));
  const c1 = writeRef(baseDir, 'packages/mcp-platform/dist/memory/index.d.ts', 'export interface PlatformMemoryV1 {}\n');
  const c2 = writeRef(baseDir, 'packages/mcp-broker/dist/memory/index.d.ts', 'export interface BrokerMemoryV1 {}\n');
  for (const r of [c1, c2, cpSchemaRef]) writeRef(baseDir, `retained/${r.path}`, r.bytes);
  const contractInventory = [
    { path: c1.path, version: '0.4.0', sha256: c1.sha256 },
    { path: c2.path, version: '0.2.0', sha256: c2.sha256 },
    { path: cpSchemaRef.path, version: '1.0.0', sha256: cpSchemaRef.sha256 },
  ];
  const immRefs = (PROOF_CATALOG.immutableFixtures || []).map((p) => ({ path: p, sha256: writeRef(baseDir, p, `// immutable fixture ${p}\n`).sha256 }));
  for (const m of PROOF_CATALOG.pendingPredecessorMappings || []) writeRef(baseDir, m.file.endsWith('.ts') ? m.file : `${m.file}/index.json`, '// predecessor\n');
  const refSrcRef = writeRef(baseDir, 'packages/mcp-broker/dist/memory-reference/index.js', 'export class SqliteMemoryWorkflowStoreV1 { static driver = "node:sqlite"; }\n');
  const regRef = writeRef(baseDir, 'packages/mcp-platform/dist/registry.d.ts', 'export interface RegistryV1 {}\n');
  const gwRef = writeRef(baseDir, 'packages/cluster-mesh/dist/compose/mcp.d.ts', 'export interface MeshMcpV1 {}\n');
  const fenceRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/sqlite-fence-profile-v1.json', { driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL' });
  const prodPolRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/sent-tech-assurance-v1.json', { issuer: 'https://auth.sent-tech.ca', qualificationOnly: false });
  const qualPolRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/qualification-assurance-v1.json', { issuer: 'https://qual.local', qualificationOnly: true });
  const verRef = writeRef(baseDir, 'tools/memory-mcp-l5/verifier.mjs', 'export const clean = true;\n');
  const trustRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/trust-profile-v1.json', { productionPolicySha256: prodPolRef.sha256, qualificationPolicySha256: qualPolRef.sha256 });
  writeRef(baseDir, 'installed/node_modules/@modelcontextprotocol/sdk/package.json', { name: '@modelcontextprotocol/sdk', version: '1.31.0' });
  const pkgSpecs = [
    ['l4', '@sentropic/engram', '0.20.1', 'archives/engram.tgz', { '.': './dist/index.js' }, [['dist/index.js', 'export const clean = true;\n']]],
    ['platform', '@sentropic/mcp-platform', '0.4.0', 'archives/platform.tgz', { '.': './dist/index.js', './memory': './dist/memory/index.js' }, [['dist/index.js', 'export const clean = true;\n'], ['dist/memory/index.js', 'export const clean = true;\n']]],
    ['broker', '@sentropic/mcp-broker', '0.2.0', 'archives/broker.tgz', { '.': './dist/index.js', './memory': './dist/memory/index.js', './memory-reference': './dist/memory-reference/index.js' }, [['dist/index.js', 'export const clean = true;\n'], ['dist/memory/index.js', 'export const clean = true;\n'], ['dist/memory-reference/index.js', 'export const clean = true;\n']]],
    ['mesh', '@sentropic/cluster-mesh', '0.19.0', 'archives/mesh.tgz', { '.': './dist/index.js' }, [['dist/index.js', 'export const clean = true;\n']]],
  ];
  const artifacts = pkgSpecs.map(([role, name, version, archive, exportsMap, files]) => {
    const pkgJson = { name, version, type: 'module', exports: exportsMap };
    writeRef(baseDir, `installed/node_modules/${name}/package.json`, pkgJson);
    for (const [rel, body] of files) writeRef(baseDir, `installed/node_modules/${name}/${rel}`, body);
    const tarBytes = makeTarGz([['package/package.json', pkgJson], ...files.map(([rel, body]) => [`package/${rel}`, body])]);
    const f = writeRef(baseDir, archive, tarBytes);
    return { role, name, version, sha256: f.sha256, integrity: f.integrity, sourceHead: C40, archiveRef: archive };
  });
  const packedRootPaths = {
    '@sentropic/mcp-platform/memory': 'installed/node_modules/@sentropic/mcp-platform/dist/memory/index.js',
    '@sentropic/mcp-broker': 'installed/node_modules/@sentropic/mcp-broker/dist/index.js',
    '@sentropic/mcp-broker/memory': 'installed/node_modules/@sentropic/mcp-broker/dist/memory/index.js',
    '@sentropic/mcp-broker/memory-reference': 'installed/node_modules/@sentropic/mcp-broker/dist/memory-reference/index.js',
  };
  const resolvedFiles = PROOF_CATALOG.importGraphRoots.map((root) => {
    const p = packedRootPaths[root] || root;
    const f = existsSync(join(baseDir, p)) ? { path: p, sha256: sha256OfBytes(readFileSync(join(baseDir, p))) } : writeRef(baseDir, p, 'export const clean = true;\n');
    return { root, path: f.path, sha256: f.sha256 };
  });
  const resolvedFilesSha256 = sha256OfBytes(Buffer.from(canonicalizeJson(resolvedFiles)));
  const graphFile = writeRef(baseDir, 'import-graph.json', {
    roots: PROOF_CATALOG.importGraphRoots, resolvedFiles, edges: [], resolvedFilesSha256, forbiddenHits: 0, unresolvedEdges: 0,
  });
  const treePaths = [...new Set([
    ...PROOF_CATALOG.importGraphRoots.filter((r) => !r.startsWith('@sentropic/')),
    ...contractInventory.map((x) => x.path), cpSchemaRef.path, mfSchemaRef.path, catFileRef.path, ...immRefs.map((x) => x.path),
  ])];
  const treeRef = writeRef(baseDir, 'receipts/source-tree.json', {
    repository: 'rhanka/sentropic', head: C40, base: C40, merge: C40, checkout: C40,
    files: treePaths.map((p) => ({ path: p, sha256: sha256OfBytes(readFileSync(join(baseDir, p))) })),
  });
  const lockPackages = { 'node_modules/@modelcontextprotocol/sdk': { version: '1.31.0', range: '^1.31.0' } };
  for (const a of artifacts) lockPackages[`node_modules/${a.name}`] = { version: a.version, resolved: a.archiveRef, integrity: a.integrity, sha256: a.sha256 };
  const lockRef = writeRef(baseDir, 'package-lock.json', { lockfileVersion: 3, packages: lockPackages });
  const instLockRef = writeRef(baseDir, 'receipts/installed-lock.json', { sdkVersion: '1.31.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'], packages: lockPackages });
  const mfSource = { specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, br3Commit: C40, l5Head: C40, sdkRange: '^1.31.0', declaredLockSha256: lockRef.sha256, lockFingerprintVersion: 2,
    lockFingerprint: computeLockFingerprint({ lockDoc: JSON.parse(lockRef.bytes.toString('utf8')), makefileText: SYNTH_MAKEFILE, configFiles: {} }),
    declaredLockSnapshot: { path: `lock-snapshots/${lockRef.sha256}.package-lock.json`, sha256: lockRef.sha256 } };
  const toMfItem = (a) => ({ role: a.role, name: a.name, version: a.version, sha256: a.sha256, integrity: a.integrity, sourceHead: a.sourceHead, archive: a.archiveRef });
  const preMf = writeRef(baseDir, 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json', {
    manifestVersion: 1, stage: 'pre-candidate', source: mfSource, artifacts: [toMfItem(artifacts[1]), toMfItem(artifacts[2])], contractInventory,
  });
  const l4BuildFile = writeRef(baseDir, 'receipts/l4-build.json', {
    builtAgainstPreCandidateSha256: preMf.sha256, e4ArtifactSha256: artifacts[0].sha256, sourceHead: C40,
  });
  const candMf = writeRef(baseDir, 'tools/memory-mcp-l5/artifacts/candidate-manifest.json', {
    manifestVersion: 1, stage: 'candidate', preCandidateManifestSha256: preMf.sha256, e4ArtifactSha256: artifacts[0].sha256,
    l4BuildReceipt: { path: l4BuildFile.path, sha256: l4BuildFile.sha256 }, source: mfSource, artifacts: artifacts.map(toMfItem), contractInventory,
  });
  const compFile = writeRef(baseDir, 'receipts/contract-comparison.json', {
    identical: true, preCandidateManifestSha256: preMf.sha256, candidateManifestSha256: candMf.sha256, contracts: contractInventory,
  });
  const instClosureRef = writeRef(baseDir, 'receipts/installed-closure.json', {
    artifactManifestSha256: candMf.sha256, sdkVersion: '1.31.0', referenceExport: '@sentropic/mcp-broker/memory-reference', artifacts,
  });
  writeRef(baseDir, 'receipts/runtime-probe.json', {
    tupleHead: C40, artifactManifestSha256: candMf.sha256, nodeVersion: '24.2.0', imageDigest: PINNED_IMAGE, platform: 'linux/amd64', sqliteVersion: '3.49.1',
    driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL', filesystem: 'ext4', filesystemAssumptions: 'local-posix-fsync',
    fenceProfileSha256: fenceRef.sha256, pythonCount: 0, addonBuildCount: 0, execArgv: [], nodeOptions: '',
  });
  const freezeRef = writeRef(baseDir, 'spec/evidence/memory-mcp-l5/l0-freeze.json', {
    specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, imageDigest: PINNED_IMAGE, checkpointSchemaSha256: cpSchemaRef.sha256,
    artifactManifestSchemaSha256: mfSchemaRef.sha256, proofCatalogSha256: catFileRef.sha256,
    immutableFixtures: immRefs, authorizedOwners: PROOF_CATALOG.authorizedOwners,
  });
  const proofs = PROOF_CATALOG.proofs.map((cat) => {
    const testResults = cat.files.map((file) => {
      const cases = (cat.fileCases && cat.fileCases[file]) || [cat.requiredCases[0]];
      return { name: file, status: 'passed', assertionResults: cases.map((c) => ({ title: c, fullName: c, status: 'passed' })) };
    });
    const executed = testResults.flatMap((tr) => tr.assertionResults.map((ar) => ({ file: tr.name, caseId: ar.fullName, status: 'passed' })));
    const rep = writeRef(baseDir, `results/${cat.id}.json`, {
      success: true, runId: '1001', attempt: 1, sourceHead: C40, artifactManifestSha256: candMf.sha256,
      numTotalTests: executed.length, numPassedTests: executed.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults,
    });
    return {
      id: cat.id, files: [...cat.files], command: cat.command,
      result: { path: rep.path, sha256: rep.sha256, format: 'vitest-json', passed: executed.length, failed: 0, skipped: 0, todo: 0, executedCasesSha256: sha256OfBytes(Buffer.from(canonicalizeJson(executed))) },
      artifactManifestSha256: candMf.sha256, sourceHead: C40, runId: '1001', attempt: 1,
    };
  });
  const doc = {
    schemaVersion: 1, checkpoint: 'L5-MEMORY-V1', phase: 'candidate', tupleSha256: H64,
    source: { repository: 'rhanka/sentropic', head: C40, base: C40, merge: C40, checkout: C40, sourceTreeSha256: treeRef.sha256 },
    contracts: {
      specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, l0Freeze: { path: freezeRef.path, sha256: freezeRef.sha256 },
      fixtures: [{ path: ev.path, sha256: ev.sha256 }], registrySha256: regRef.sha256, gatewaySha256: gwRef.sha256,
      exports: [{ path: ev.path, sha256: ev.sha256 }],
      schemas: [
        { path: cpSchemaRef.path, sha256: cpSchemaRef.sha256 },
        { path: mfSchemaRef.path, sha256: mfSchemaRef.sha256 },
        { path: catFileRef.path, sha256: catFileRef.sha256 },
      ],
      profiles: [{ path: ev.path, sha256: ev.sha256 }], entry: { path: ev.path, sha256: ev.sha256 }, providerManifest: { path: ev.path, sha256: ev.sha256 },
    },
    preCandidate: {
      manifestSha256: preMf.sha256, contractInventory,
      l4BuildReceipt: { path: l4BuildFile.path, sha256: l4BuildFile.sha256 }, contractComparison: { path: compFile.path, sha256: compFile.sha256 },
    },
    artifacts,
    closure: {
      artifactManifestSha256: candMf.sha256, declaredLockSha256: lockRef.sha256, installedLockSha256: instLockRef.sha256,
      installedClosureSha256: instClosureRef.sha256, sdkVersion: '1.31.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'],
      referenceExport: '@sentropic/mcp-broker/memory-reference', referenceSourceSha256: refSrcRef.sha256,
    },
    runtime: {
      nodeVersion: '24.2.0', imageDigest: PINNED_IMAGE, platform: 'linux/amd64', sqliteVersion: '3.49.1',
      driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL', filesystem: 'ext4',
      filesystemAssumptions: 'local-posix-fsync', fenceProfileSha256: fenceRef.sha256, pythonCount: 0, addonBuildCount: 0,
    },
    assurance: {
      productionPolicySha256: prodPolRef.sha256, qualificationPolicySha256: qualPolRef.sha256,
      verifierArtifactSha256: verRef.sha256, trustProfileSha256: trustRef.sha256, qualificationOnly: true,
    },
    proofs,
    importGraph: { path: graphFile.path, sha256: graphFile.sha256, roots: [...PROOF_CATALOG.importGraphRoots], resolvedFilesSha256, forbiddenHits: 0, unresolvedEdges: 0 },
    ci: {
      workflow: '.github/workflows/ci.yml', runId: '1001', attempt: 1, head: C40, base: C40, merge: C40, checkout: C40,
      imageDigest: PINNED_IMAGE, artifactName: `memory-mcp-l5-${C40}-1001-1`,
      jobs: [],
    },
    ownerUat: {}, acceptances: [],
  };
  doc.tupleSha256 = computeTupleSha256(doc);
  const jobRef = writeRef(baseDir, 'receipts/ci-job-memory-l5-qualification.json', {
    jobId: 'memory-l5-qualification', runId: '1001', attempt: 1, head: C40, base: C40, merge: C40, checkout: C40,
    imageDigest: PINNED_IMAGE, artifactName: `memory-mcp-l5-${C40}-1001-1`, tupleSha256: doc.tupleSha256, conclusion: 'success',
    proofResultSha256s: proofs.map((p) => ({ id: p.id, sha256: p.result.sha256 })),
  });
  doc.ci.jobs = [{ id: 'memory-l5-qualification', conclusion: 'success', resultSha256: jobRef.sha256 }];
  writeRef(baseDir, 'receipts/ci-run.json', {
    workflow: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', runId: '1001', attempt: 1,
    head: C40, base: C40, merge: C40, checkout: C40, imageDigest: PINNED_IMAGE, artifactName: `memory-mcp-l5-${C40}-1001-1`, tupleSha256: doc.tupleSha256,
  });
  const uatRef = writeRef(baseDir, 'receipts/owner-uat.json', {
    tupleSha256: doc.tupleSha256, authoritySourceSha256: freezeRef.sha256, ciRunId: '1001', status: 'passed', policySha256: prodPolRef.sha256, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z',
  });
  doc.ownerUat = { status: 'passed', evidence: { path: uatRef.path, sha256: uatRef.sha256 }, policySha256: prodPolRef.sha256, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z' };
  doc.acceptances = ACCEPTANCE_ROLES.map((role) => {
    const accRef = writeRef(baseDir, `receipts/accept-${role}.json`, {
      role, actorRef: `owner:${role}`, tupleSha256: doc.tupleSha256, authoritySourceSha256: freezeRef.sha256, ciRunId: '1001', verdict: 'accepted',
    });
    return { role, actorRef: `owner:${role}`, tupleSha256: doc.tupleSha256, verdict: 'accepted', evidence: { path: accRef.path, sha256: accRef.sha256 } };
  });
  return { doc, preMf, candMf, opts: { baseDir, manifestBytes: candMf.bytes, preCandidateManifestBytes: preMf.bytes, execArgv: [], nodeOptions: '' } };
}
function rebindTuple(baseDir, doc) {
  doc.tupleSha256 = computeTupleSha256(doc);
  const jobRef = writeRef(baseDir, 'receipts/ci-job-memory-l5-qualification.json', {
    jobId: 'memory-l5-qualification', runId: doc.ci.runId, attempt: doc.ci.attempt, head: doc.ci.head, base: doc.ci.base, merge: doc.ci.merge, checkout: doc.ci.checkout,
    imageDigest: doc.ci.imageDigest, artifactName: doc.ci.artifactName, tupleSha256: doc.tupleSha256, conclusion: 'success',
    proofResultSha256s: doc.proofs.map((p) => ({ id: p.id, sha256: p.result.sha256 })),
  });
  doc.ci.jobs = [{ id: 'memory-l5-qualification', conclusion: 'success', resultSha256: jobRef.sha256 }];
  writeRef(baseDir, 'receipts/ci-run.json', {
    workflow: doc.ci.workflow, status: 'completed', conclusion: 'success', runId: doc.ci.runId, attempt: doc.ci.attempt,
    head: doc.ci.head, base: doc.ci.base, merge: doc.ci.merge, checkout: doc.ci.checkout, imageDigest: doc.ci.imageDigest, artifactName: doc.ci.artifactName, tupleSha256: doc.tupleSha256,
  });
  const uatRef = writeRef(baseDir, 'receipts/owner-uat.json', {
    tupleSha256: doc.tupleSha256, authoritySourceSha256: doc.contracts.l0Freeze.sha256, ciRunId: doc.ci.runId, status: doc.ownerUat.status,
    ...(doc.ownerUat.status === 'passed' ? { policySha256: doc.ownerUat.policySha256 } : { owningLot: doc.ownerUat.owningLot, reason: doc.ownerUat.reason }),
    actorRef: doc.ownerUat.actorRef, recordedAt: doc.ownerUat.recordedAt,
  });
  doc.ownerUat.evidence = { path: uatRef.path, sha256: uatRef.sha256 };
  doc.acceptances = doc.acceptances.map((a) => {
    const accRef = writeRef(baseDir, `receipts/accept-${a.role}.json`, {
      role: a.role, actorRef: a.actorRef, tupleSha256: doc.tupleSha256, authoritySourceSha256: doc.contracts.l0Freeze.sha256, ciRunId: doc.ci.runId, verdict: 'accepted',
    });
    return { ...a, tupleSha256: doc.tupleSha256, evidence: { path: accRef.path, sha256: accRef.sha256 } };
  });
  return doc;
}
function withBundle(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'l5-cp-'));
  try { return fn(buildCheckpointBundle(dir), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('P10.tooling.receipt-contract — L5 receipt contract and closed checkpoint schema', () => {
  it('P10.tooling.receipt-contract: aligns closed schema bounds and catalog P01-P10 fileCases, commands, source/packed roots, and authorizedOwners', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.artifacts.maxItems).toBe(128);
    expect(catalog.proofs.map((p) => p.id)).toEqual(PROOF_IDS);
    expect(catalog.proofs.find((p) => p.id === 'P02').files).toContain('tools/memory-mcp-l5/packed/identity-source-refusal.test.ts');
    expect(catalog.proofs.find((p) => p.id === 'P09').files).toHaveLength(22);
    expect(catalog.importGraphRoots).toContain('tools/memory-mcp-l5/verifier.mjs');
    expect(catalog.importGraphRoots).toContain('@sentropic/mcp-platform/memory');
    expect(catalog.importGraphRoots).toContain('@sentropic/mcp-broker/memory-reference');
    expect(Array.isArray(catalog.authorizedOwners?.ownerUat)).toBe(true);
    for (const p of catalog.proofs) {
      expect(typeof p.fileCases).toBe('object');
      for (const f of p.files) expect(p.fileCases[f]?.length).toBeGreaterThan(0);
    }
  });

// Lot 1 state: the importGraph.resolver obligation cleared when Lot 1
// delivered tools/memory-mcp-l5/import-graph.mjs. The remaining entries are
// still pending (predecessors, verifier, CI/owner/acceptance provenance).
const EXPECTED_LOT0_OBLIGATIONS = [
  'provenance.predecessors: pendingPredecessorMappings remain unresolved (BR3/L5-F1)',
  'assurance.verifier: tools/memory-mcp-l5/verifier.mjs is not yet implemented (Lot 2 obligation)',
  'ci.provenance: trusted CI run provenance is not established by local evidence files',
  'ownerUat.provenance: authenticated owner decision provenance is not established by local actorRef strings',
  'acceptances.provenance: authenticated co-owner acceptance provenance is not established by local actorRef strings',
];

  it('P10.tooling.receipt-contract: validates complete acyclic on-disk bundle, both ownerUat branches, and rejects prototype/nested extra or omitted keys', () => withBundle(({ doc, opts }, dir) => {
    expect(checkCheckpoint(doc, opts)).toEqual(EXPECTED_LOT0_OBLIGATIONS);
    const deferred = structuredClone(doc);
    const defRef = writeRef(dir, 'receipts/owner-uat-def.json', {
      tupleSha256: doc.tupleSha256, authoritySourceSha256: doc.contracts.l0Freeze.sha256, ciRunId: '1001',
      status: 'owner-deferred', actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z', owningLot: 'L6', reason: 'preprod IdP maintenance window',
    });
    deferred.ownerUat = { status: 'owner-deferred', evidence: { path: defRef.path, sha256: defRef.sha256 }, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z', owningLot: 'L6', reason: 'preprod IdP maintenance window' };
    expect(checkCheckpoint(deferred, opts)).toEqual(EXPECTED_LOT0_OBLIGATIONS);
    const protoCtor = structuredClone(doc);
    protoCtor.source = JSON.parse(JSON.stringify(protoCtor.source).replace(/\}$/, ',"constructor":{"unexpected":true}}'));
    expect(checkCheckpoint(protoCtor, opts).join(' ')).toMatch(/additional property constructor forbidden/);
    const protoUnder = structuredClone(doc);
    protoUnder.source = JSON.parse(JSON.stringify(protoUnder.source).replace(/\}$/, ',"__proto__":{"alsoUnexpected":true}}'));
    expect(checkCheckpoint(protoUnder, opts).join(' ')).toMatch(/additional property __proto__ forbidden/);
    const mixedUat = structuredClone(doc);
    mixedUat.ownerUat.owningLot = 'L6';
    expect(checkCheckpoint(mixedUat, opts).join(' ')).toMatch(/ownerUat: must match exactly one oneOf branch/);
    unlinkSync(join(dir, 'results/P01.json'));
    expect(checkCheckpoint(doc, opts).join(' ')).toMatch(/missing on-disk file results\/P01\.json/);
  }));

  it('P10.tooling.receipt-contract: rejects zero-assertion files, unlisted files, misplaced cases, and normalizes Vitest absolute-path reports', () => withBundle(({ doc, opts }, dir) => {
    const origP01 = readFileSync(join(dir, 'results/P01.json'));
    const emptyFileRep = JSON.parse(origP01.toString('utf8'));
    emptyFileRep.testResults[0].assertionResults = [];
    emptyFileRep.testResults.push({ name: 'unlisted/no-real-test.ts', status: 'passed', assertionResults: [{ title: 'P01.broker.invocation-context', fullName: 'P01.broker.invocation-context', status: 'passed' }] });
    const emptyRef = writeRef(dir, 'results/P01.json', emptyFileRep);
    const emptyDoc = structuredClone(doc);
    emptyDoc.proofs[0].result.sha256 = emptyRef.sha256;
    expect(checkCheckpoint(emptyDoc, opts).join(' ')).toMatch(/empty assertions|unlisted file|missing required case/i);
    writeFileSync(join(dir, 'results/P01.json'), origP01);

    const p10Rep = JSON.parse(readFileSync(join(dir, 'results/P10.json'), 'utf8'));
    p10Rep.testResults = p10Rep.testResults.map((tr) => ({
      ...tr,
      name: join(dir, tr.name),
      assertionResults: tr.assertionResults.map((ar) => ({ ...ar, fullName: `${ar.title} — suite > ${ar.title}: case` })),
    }));
    const normExec = p10Rep.testResults.flatMap((tr) => tr.assertionResults.map((ar) => ({ file: tr.name.slice(dir.length + 1), caseId: ar.fullName, status: 'passed' })));
    const p10Ref = writeRef(dir, 'results/P10.json', p10Rep);
    const absDoc = structuredClone(doc);
    absDoc.proofs[9].result.sha256 = p10Ref.sha256;
    absDoc.proofs[9].result.executedCasesSha256 = sha256OfBytes(Buffer.from(canonicalizeJson(normExec)));
    rebindTuple(dir, absDoc);
    expect(checkCheckpoint(absDoc, opts)).toEqual(EXPECTED_LOT0_OBLIGATIONS);
  }));

  it('P10.tooling.receipt-contract: rejects invalid/substituted manifests, candidate source drift, extra P1 contracts, and mutated contract bytes', () => withBundle(({ doc, preMf, candMf, opts }, dir) => {
    expect(checkCheckpoint(doc, { ...opts, manifestBytes: Buffer.from('{"manifestVersion":1,"stage":"candidate"}') }).join(' ')).toMatch(/manifest|artifactManifestSha256/);
    expect(checkCheckpoint(doc, { ...opts, preCandidateManifestBytes: Buffer.from('NOT JSON') }).join(' ')).toMatch(/preCandidate|JSON/);
    expect(checkCheckpoint(doc, { ...opts, preCandidateManifestBytes: candMf.bytes }).join(' ')).toMatch(/preCandidate/);

    const candDrift = JSON.parse(candMf.bytes.toString('utf8'));
    candDrift.source.specSha256 = 'c'.repeat(64);
    candDrift.source.l0Commit = 'd'.repeat(40);
    const candDriftRef = writeRef(dir, candMf.path, candDrift);
    const compDrift = writeRef(dir, 'receipts/contract-comparison.json', {
      identical: true, preCandidateManifestSha256: preMf.sha256, candidateManifestSha256: candDriftRef.sha256, contracts: doc.preCandidate.contractInventory,
    });
    const instClosureDrift = writeRef(dir, 'receipts/installed-closure.json', {
      artifactManifestSha256: candDriftRef.sha256, sdkVersion: '1.31.0', referenceExport: '@sentropic/mcp-broker/memory-reference', artifacts: doc.artifacts,
    });
    const origProbe = readFileSync(join(dir, 'receipts/runtime-probe.json'));
    writeRef(dir, 'receipts/runtime-probe.json', { ...JSON.parse(origProbe.toString('utf8')), artifactManifestSha256: candDriftRef.sha256 });
    const driftDoc = structuredClone(doc);
    driftDoc.preCandidate.contractComparison.sha256 = compDrift.sha256;
    driftDoc.closure.artifactManifestSha256 = candDriftRef.sha256;
    driftDoc.closure.installedClosureSha256 = instClosureDrift.sha256;
    const origReports = driftDoc.proofs.map((p) => [p.result.path, readFileSync(join(dir, p.result.path))]);
    driftDoc.proofs = driftDoc.proofs.map((p) => {
      const r = writeRef(dir, p.result.path, { ...JSON.parse(readFileSync(join(dir, p.result.path), 'utf8')), artifactManifestSha256: candDriftRef.sha256 });
      return { ...p, artifactManifestSha256: candDriftRef.sha256, result: { ...p.result, sha256: r.sha256 } };
    });
    rebindTuple(dir, driftDoc);
    expect(checkCheckpoint(driftDoc, { ...opts, manifestBytes: candDriftRef.bytes }).join(' ')).toMatch(/candidateManifest\.source mismatch/);
    writeFileSync(join(dir, 'receipts/runtime-probe.json'), origProbe);
    for (const [p, b] of origReports) writeFileSync(join(dir, p), b);

    const extraP1 = JSON.parse(preMf.bytes.toString('utf8'));
    extraP1.contractInventory.push({ path: 'packages/mcp-broker/dist/memory/missing.d.ts', version: '0.2.0', sha256: H64 });
    const extraP1Bytes = Buffer.from(JSON.stringify(extraP1), 'utf8');
    const extraDoc = structuredClone(doc);
    extraDoc.preCandidate.manifestSha256 = sha256OfBytes(extraP1Bytes);
    expect(checkCheckpoint(extraDoc, { ...opts, preCandidateManifestBytes: extraP1Bytes }).join(' ')).toMatch(/preCandidate|contractInventory|missing on-disk file/);
    writeFileSync(join(dir, 'packages/mcp-platform/dist/memory/index.d.ts'), 'export interface Mutated {}\n');
    expect(checkCheckpoint(doc, opts).join(' ')).toMatch(/preCandidate\.qualified.*sha256 mismatch/);
  }));

  it('P10.tooling.receipt-contract: verifies source-tree, installed-lock, installed-closure, tarballs, runtime-probe, import-graph, and ci-run contents', () => withBundle(({ doc, opts }, dir) => {
    const badTreeRef = writeRef(dir, 'receipts/source-tree-bad.json', { repository: 'rhanka/sentropic', head: 'd'.repeat(40), base: C40, merge: C40, checkout: C40, files: [] });
    writeFileSync(join(dir, 'receipts/source-tree.json'), badTreeRef.bytes);
    const treeDoc = rebindTuple(dir, { ...structuredClone(doc), source: { ...doc.source, sourceTreeSha256: badTreeRef.sha256 } });
    expect(checkCheckpoint(treeDoc, opts).join(' ')).toMatch(/source\.sourceTree/);

    const badLockRef = writeRef(dir, 'receipts/installed-lock.json', { sdkVersion: '0.1.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'], packages: {} });
    const lockDoc = rebindTuple(dir, { ...structuredClone(doc), closure: { ...doc.closure, installedLockSha256: badLockRef.sha256 } });
    expect(checkCheckpoint(lockDoc, opts).join(' ')).toMatch(/closure\.installedLock/);

    const badClosRef = writeRef(dir, 'receipts/installed-closure.json', { artifactManifestSha256: doc.closure.artifactManifestSha256, sdkVersion: '1.31.0', referenceExport: '@sentropic/mcp-broker/memory-reference', artifacts: [] });
    const closDoc = rebindTuple(dir, { ...structuredClone(doc), closure: { ...doc.closure, installedClosureSha256: badClosRef.sha256 } });
    expect(checkCheckpoint(closDoc, opts).join(' ')).toMatch(/closure\.installedClosure: artifacts mismatch/);

    const badProbe = { ...JSON.parse(readFileSync(join(dir, 'receipts/runtime-probe.json'), 'utf8')), execArgv: ['--experimental-sqlite'], tupleHead: 'd'.repeat(40), nodeVersion: '22.13.0' };
    writeRef(dir, 'receipts/runtime-probe.json', badProbe);
    const node22Doc = rebindTuple(dir, { ...structuredClone(doc), runtime: { ...doc.runtime, nodeVersion: '22.13.0' } });
    expect(checkCheckpoint(node22Doc, opts).join(' ')).toMatch(/runtime\.nodeVersion|runtime\.probe/);

    writeRef(dir, 'receipts/ci-run.json', {
      workflow: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', runId: '1001', attempt: 1,
      head: C40, base: 'd'.repeat(40), merge: 'd'.repeat(40), checkout: 'd'.repeat(40), imageDigest: `sha256:${H64}`, artifactName: 'wrong-artifact', tupleSha256: doc.tupleSha256,
    });
    expect(checkCheckpoint(doc, opts).join(' ')).toMatch(/ci\.evidence: ci-run\.json field mismatch/);

    const origGraph = JSON.parse(readFileSync(join(dir, 'import-graph.json'), 'utf8'));
    const dupResolved = PROOF_CATALOG.importGraphRoots.map(() => ({ root: 'unrelated-root', path: 'tools/memory-mcp-l5/verifier.mjs', sha256: doc.assurance.verifierArtifactSha256 }));
    const dupSha = sha256OfBytes(Buffer.from(canonicalizeJson(dupResolved)));
    const dupGraph = writeRef(dir, 'import-graph.json', { roots: PROOF_CATALOG.importGraphRoots, resolvedFiles: dupResolved, edges: [], resolvedFilesSha256: dupSha, forbiddenHits: 0, unresolvedEdges: 0 });
    const dupDoc = rebindTuple(dir, { ...structuredClone(doc), importGraph: { ...doc.importGraph, sha256: dupGraph.sha256, resolvedFilesSha256: dupSha } });
    expect(checkCheckpoint(dupDoc, opts).join(' ')).toMatch(/importGraph: resolvedFiles roots mismatch/);

    const badVer = writeRef(dir, 'tools/memory-mcp-l5/verifier.mjs', "export * from '../../cluster-mesh/src/mock/oidc.ts';\n");
    const forbidResolved = origGraph.resolvedFiles.map((rf) => (rf.root === 'tools/memory-mcp-l5/verifier.mjs' ? { ...rf, sha256: badVer.sha256 } : rf));
    const forbidSha = sha256OfBytes(Buffer.from(canonicalizeJson(forbidResolved)));
    const forbidGraph = writeRef(dir, 'import-graph.json', { roots: PROOF_CATALOG.importGraphRoots, resolvedFiles: forbidResolved, edges: [], resolvedFilesSha256: forbidSha, forbiddenHits: 0, unresolvedEdges: 0 });
    const forbidDoc = rebindTuple(dir, {
      ...structuredClone(doc),
      assurance: { ...doc.assurance, verifierArtifactSha256: badVer.sha256 },
      importGraph: { ...doc.importGraph, sha256: forbidGraph.sha256, resolvedFilesSha256: forbidSha },
    });
    expect(checkCheckpoint(forbidDoc, opts).join(' ')).toMatch(/importGraph: forbidden import/);

    const plainTgz = writeRef(dir, 'archives/engram.tgz', 'package: @sentropic/engram@0.20.1');
    const plainDoc = structuredClone(doc);
    plainDoc.artifacts[0].sha256 = plainTgz.sha256;
    plainDoc.artifacts[0].integrity = plainTgz.integrity;
    expect(checkCheckpoint(plainDoc, opts).join(' ')).toMatch(/invalid tar\.gz archive/);
  }));

  it('P10.tooling.receipt-contract: handles malformed shapes without crashing and keeps checkpoint CLI gated on Lot 0 obligations', () => withBundle(({ doc, preMf, candMf }, dir) => {
    expect(checkCheckpoint({ schemaVersion: 1, checkpoint: 'L5-MEMORY-V1', artifacts: {}, ci: { jobs: {} }, proofs: [null] }, {}).length).toBeGreaterThan(0);
    const badFile = join(dir, 'malformed.json');
    writeFileSync(badFile, JSON.stringify({ artifacts: {}, ci: { jobs: {} }, proofs: [null] }));
    const preBad = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'preflight', '--checkpoint', badFile], { encoding: 'utf8' });
    expect(preBad.status).toBe(0);
    expect(JSON.parse(preBad.stdout).accepted).toBe(false);
    expect(JSON.parse(preBad.stdout).outstanding.length).toBeGreaterThan(0);
    const cpBad = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', badFile], { encoding: 'utf8' });
    expect(cpBad.status).toBe(1);

    const cpFile = join(dir, 'checkpoint.json');
    writeFileSync(cpFile, JSON.stringify(doc));
    const preBundle = spawnSync(process.execPath, [
      RECEIPT_BIN, '--mode', 'preflight', '--checkpoint', cpFile,
      '--manifest', join(dir, candMf.path), '--pre-candidate-manifest', join(dir, preMf.path), '--base-dir', dir,
    ], { encoding: 'utf8' });
    expect(preBundle.status).toBe(0);
    expect(JSON.parse(preBundle.stdout)).toEqual({ mode: 'preflight', accepted: false, outstanding: EXPECTED_LOT0_OBLIGATIONS });

    const cpGate = spawnSync(process.execPath, [
      RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', cpFile,
      '--manifest', join(dir, candMf.path), '--pre-candidate-manifest', join(dir, preMf.path), '--base-dir', dir,
    ], { encoding: 'utf8' });
    expect(cpGate.status).toBe(1);
    expect(JSON.parse(cpGate.stdout)).toEqual({ mode: 'checkpoint', accepted: false, failures: EXPECTED_LOT0_OBLIGATIONS });
  }));
});
