import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
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

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'schemas', 'checkpoint-v1.schema.json');
const MANIFEST_SCHEMA_PATH = join(HERE, '..', 'schemas', 'artifact-manifest-v1.schema.json');
const CATALOG_PATH = join(HERE, '..', 'proof-catalog-v1.json');
const RECEIPT_BIN = join(HERE, '..', 'receipt.mjs');

const H64 = 'a'.repeat(64);
const C40 = 'b'.repeat(40);
const PINNED_IMAGE = `node:24-bookworm-slim@sha256:${H64}`;

function writeRef(baseDir, relPath, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  const abs = join(baseDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return { path: relPath, bytes, sha256: sha256OfBytes(bytes), integrity: sha512Integrity(bytes) };
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
  const lockRef = writeRef(baseDir, 'package-lock.json', { lockfileVersion: 3, packages: { 'node_modules/@modelcontextprotocol/sdk': { version: '1.31.0', range: '^1.31.0' } } });
  const instLockRef = writeRef(baseDir, 'receipts/installed-lock.json', { sdkVersion: '1.31.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'] });
  const refSrcRef = writeRef(baseDir, 'packages/mcp-broker/dist/memory-reference/index.js', 'export class SqliteMemoryWorkflowStoreV1 { static driver = "node:sqlite"; }\n');
  const treeRef = writeRef(baseDir, 'receipts/source-tree.json', { repository: 'rhanka/sentropic', head: C40, base: C40, merge: C40, checkout: C40, files: [{ path: c1.path, sha256: c1.sha256 }] });
  const regRef = writeRef(baseDir, 'packages/mcp-platform/dist/registry.d.ts', 'export interface RegistryV1 {}\n');
  const gwRef = writeRef(baseDir, 'packages/cluster-mesh/dist/compose/mcp.d.ts', 'export interface MeshMcpV1 {}\n');
  const fenceRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/sqlite-fence-profile-v1.json', { driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL' });
  writeRef(baseDir, 'receipts/runtime-probe.json', {
    tupleHead: C40, nodeVersion: '24.2.0', imageDigest: PINNED_IMAGE, platform: 'linux/amd64', sqliteVersion: '3.49.1',
    driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL', filesystem: 'ext4', filesystemAssumptions: 'local-posix-fsync',
    fenceProfileSha256: fenceRef.sha256, pythonCount: 0, addonBuildCount: 0, execArgv: [], nodeOptions: '',
  });
  const prodPolRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/sent-tech-assurance-v1.json', { issuer: 'https://auth.sent-tech.ca', qualificationOnly: false });
  const qualPolRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/qualification-assurance-v1.json', { issuer: 'https://qual.local', qualificationOnly: true });
  const verRef = writeRef(baseDir, 'tools/memory-mcp-l5/verifier.mjs', 'export const verifyAssurance = () => true;\n');
  const trustRef = writeRef(baseDir, 'tools/memory-mcp-l5/policies/trust-profile-v1.json', { productionPolicySha256: prodPolRef.sha256, qualificationPolicySha256: qualPolRef.sha256 });
  const roles = [
    ['l4', '@sentropic/engram', '0.20.1', 'archives/engram.tgz'],
    ['platform', '@sentropic/mcp-platform', '0.4.0', 'archives/platform.tgz'],
    ['broker', '@sentropic/mcp-broker', '0.2.0', 'archives/broker.tgz'],
    ['mesh', '@sentropic/cluster-mesh', '0.19.0', 'archives/mesh.tgz'],
  ];
  const artifacts = roles.map(([role, name, version, archive]) => {
    const f = writeRef(baseDir, archive, `${name}@${version}`);
    return { role, name, version, sha256: f.sha256, integrity: f.integrity, sourceHead: C40, archiveRef: archive };
  });
  const mfSource = { specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, br3Commit: C40, l5Head: C40, sdkRange: '^1.31.0', declaredLockSha256: lockRef.sha256 };
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
    artifactManifestSha256: candMf.sha256, sdkVersion: '1.31.0', referenceExport: '@sentropic/mcp-broker/memory-reference',
    artifacts: artifacts.map((a) => ({ name: a.name, version: a.version, sha256: a.sha256 })),
  });
  const resolvedFiles = PROOF_CATALOG.importGraphRoots.map((root) => {
    const p = root.startsWith('@sentropic/') ? `packages/${root.replace('@sentropic/', '')}/dist/index.js` : root;
    const f = writeRef(baseDir, p, 'export const clean = true;\n');
    return { root, path: f.path, sha256: f.sha256 };
  });
  const resolvedFilesSha256 = sha256OfBytes(Buffer.from(canonicalizeJson(resolvedFiles)));
  const graphFile = writeRef(baseDir, 'import-graph.json', {
    roots: PROOF_CATALOG.importGraphRoots, resolvedFiles, edges: [], resolvedFilesSha256, forbiddenHits: 0, unresolvedEdges: 0,
  });
  const freezeRef = writeRef(baseDir, 'spec/evidence/memory-mcp-l5/l0-freeze.json', {
    specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, checkpointSchemaSha256: cpSchemaRef.sha256,
    artifactManifestSchemaSha256: mfSchemaRef.sha256, proofCatalogSha256: catFileRef.sha256,
    immutableFixtures: immRefs, authorizedOwners: PROOF_CATALOG.authorizedOwners || {
      ownerUat: ['owner:antoinefa'],
      acceptances: { l4: ['owner:l4', 'owner:antoinefa'], platform: ['owner:platform', 'owner:antoinefa'], broker: ['owner:broker', 'owner:antoinefa'], transport: ['owner:transport', 'owner:antoinefa'] },
    },
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
    jobId: 'memory-l5-qualification', runId: '1001', attempt: 1, head: C40, tupleSha256: doc.tupleSha256, conclusion: 'success',
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
function withBundle(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'l5-cp-'));
  try { return fn(buildCheckpointBundle(dir), dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('L5 receipt contract and closed checkpoint schema', () => {
  it('aligns closed schema bounds and catalog P01-P10 files, commands, cases, and roots', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.artifacts.maxItems).toBe(128);
    expect(catalog.proofs.map((p) => p.id)).toEqual(PROOF_IDS);
    expect(catalog.proofs.find((p) => p.id === 'P02').files).toContain('tools/memory-mcp-l5/packed/identity-source-refusal.test.ts');
    expect(catalog.proofs.find((p) => p.id === 'P09').files).toHaveLength(22);
    expect(catalog.immutableFixtures).toContain('packages/mcp-platform/tests/wire-parity.test.ts');
    expect(catalog.pendingPredecessorMappings.map((m) => m.file)).toContain('packages/mcp-platform/tests/remote-bound-dispatch.test.ts');
  });

  it('accepts a complete on-disk bundle, both ownerUat oneOf branches, and rejects missing files or nested extra/omitted keys', () => withBundle(({ doc, opts }, dir) => {
    expect(checkCheckpoint(doc, opts)).toEqual([]);
    const deferred = structuredClone(doc);
    const defRef = writeRef(dir, 'receipts/owner-uat-def.json', {
      tupleSha256: doc.tupleSha256, status: 'owner-deferred', actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z', owningLot: 'L6', reason: 'preprod IdP maintenance window',
    });
    deferred.ownerUat = { status: 'owner-deferred', evidence: { path: defRef.path, sha256: defRef.sha256 }, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z', owningLot: 'L6', reason: 'preprod IdP maintenance window' };
    expect(checkCheckpoint(deferred, opts)).toEqual([]);
    const mixedUat = structuredClone(doc);
    mixedUat.ownerUat.owningLot = 'L6';
    expect(checkCheckpoint(mixedUat, opts).join(' ')).toMatch(/ownerUat: must match exactly one oneOf branch/);
    const nestedExtra = structuredClone(doc);
    nestedExtra.source.extraBag = 1;
    expect(checkCheckpoint(nestedExtra, opts).join(' ')).toMatch(/source: additional property extraBag forbidden/);
    const missingNested = structuredClone(doc);
    delete missingNested.source.repository;
    expect(checkCheckpoint(missingNested, opts).join(' ')).toMatch(/source: missing required property repository/);
    unlinkSync(join(dir, 'results/P01.json'));
    expect(checkCheckpoint(doc, opts).join(' ')).toMatch(/missing on-disk file results\/P01\.json/);
  }));

  it('rejects missing/duplicate proofs, skipped counts, and missing file or case ID in on-disk Vitest JSON', () => withBundle(({ doc, opts }, dir) => {
    const missing = structuredClone(doc);
    missing.proofs = missing.proofs.slice(0, 9);
    expect(checkCheckpoint(missing, opts).join(' ')).toMatch(/expected exactly 10/);
    const skipped = structuredClone(doc);
    skipped.proofs[0].result.skipped = 1;
    expect(checkCheckpoint(skipped, opts).join(' ')).toMatch(/proofs\/P01: invalid vitest-json counts/);
    const badRep = JSON.parse(readFileSync(join(dir, 'results/P01.json'), 'utf8'));
    badRep.testResults[0].assertionResults[0].title = 'wrong.case';
    badRep.testResults[0].assertionResults[0].fullName = 'wrong.case';
    const ref = writeRef(dir, 'results/P01.json', badRep);
    const badCaseDoc = structuredClone(doc);
    badCaseDoc.proofs[0].result.sha256 = ref.sha256;
    expect(checkCheckpoint(badCaseDoc, opts).join(' ')).toMatch(/missing required case P01\.broker\.invocation-context/);
  }));

  it('rejects mutated pre-candidate bytes, mismatched on-disk E4 build receipt, mutated contract bytes, and cross-digest reuse', () => withBundle(({ doc, opts }, dir) => {
    expect(checkCheckpoint(doc, { ...opts, manifestBytes: Buffer.from('mutated') }).join(' ')).toMatch(/preCandidate\.manifestSha256/);
    writeFileSync(join(dir, 'packages/mcp-platform/dist/memory/index.d.ts'), 'export interface Mutated {}\n');
    expect(checkCheckpoint(doc, opts).join(' ')).toMatch(/preCandidate\.qualified.*sha256 mismatch/);
    const cross = structuredClone(doc);
    cross.proofs[2].artifactManifestSha256 = H64;
    expect(checkCheckpoint(cross, opts).join(' ')).toMatch(/proofs\/P03: cross-digest proof reuse/);
  }));

  it('rejects missing l4 role, SDK/image/SQLite violations, unrelated CI job/tuple, and mismatched acceptance tupleSha256', () => withBundle(({ doc, opts }) => {
    const noL4 = structuredClone(doc);
    noL4.artifacts[0].role = 'dependency';
    noL4.tupleSha256 = computeTupleSha256(noL4);
    expect(checkCheckpoint(noL4, opts).join(' ')).toMatch(/requires exactly one l4 role/);
    const badClosure = structuredClone(doc);
    badClosure.closure.sdkVersion = '0.1.0';
    badClosure.runtime.imageDigest = 'unverified';
    expect(checkCheckpoint(badClosure, opts).join(' ')).toMatch(/sdkVersion.*imageDigest/s);
    expect(checkCheckpoint(doc, { ...opts, nodeOptions: '--experimental-sqlite' }).join(' ')).toMatch(/flag-dependent SQLite/);
    const badCi = structuredClone(doc);
    badCi.ci.jobs = [{ id: 'unrelated-lint', conclusion: 'success', resultSha256: H64 }];
    badCi.ci.head = 'c'.repeat(40);
    badCi.acceptances[0].tupleSha256 = H64;
    expect(checkCheckpoint(badCi, opts).join(' ')).toMatch(/ci: tuple metadata mismatch.*missing or duplicate memory-l5-qualification.*acceptances\/l4: invalid acceptance or tuple mismatch/s);
  }));

  it('requires on-disk evidence files in CLI checkpoint mode and reports missing files in preflight mode', () => withBundle(({ doc }, dir) => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'l5-empty-'));
    try {
      const emptyCp = join(emptyDir, 'checkpoint.json'), emptyMf = join(emptyDir, 'manifest.json');
      writeFileSync(emptyCp, JSON.stringify(doc));
      writeFileSync(emptyMf, MANIFEST_BYTES);
      const preMissing = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'preflight', '--checkpoint', emptyCp, '--manifest', emptyMf], { encoding: 'utf8' });
      expect(preMissing.status).toBe(0);
      expect(JSON.parse(preMissing.stdout).outstanding.length).toBeGreaterThan(0);
      const failMissing = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', emptyCp, '--manifest', emptyMf], { encoding: 'utf8' });
      expect(failMissing.status).toBe(1);
      const cpFile = join(dir, 'checkpoint.json'), mfFile = join(dir, 'manifest.json');
      writeFileSync(cpFile, JSON.stringify(doc));
      writeFileSync(mfFile, MANIFEST_BYTES);
      const pass = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', cpFile, '--manifest', mfFile, '--base-dir', dir], { encoding: 'utf8' });
      expect(pass.status).toBe(0);
      expect(JSON.parse(pass.stdout).accepted).toBe(true);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }));
});
