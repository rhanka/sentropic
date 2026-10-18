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
const CATALOG_PATH = join(HERE, '..', 'proof-catalog-v1.json');
const RECEIPT_BIN = join(HERE, '..', 'receipt.mjs');

const H64 = 'a'.repeat(64);
const C40 = 'b'.repeat(40);
const MANIFEST_BYTES = Buffer.from('{"manifestVersion":1,"stage":"candidate"}', 'utf8');
const MANIFEST_SHA = sha256OfBytes(MANIFEST_BYTES);

function writeRef(baseDir, relPath, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(typeof content === 'string' ? content : JSON.stringify(content), 'utf8');
  const abs = join(baseDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, bytes);
  return { path: relPath, sha256: sha256OfBytes(bytes), integrity: sha512Integrity(bytes) };
}

function buildCheckpointBundle(baseDir) {
  const ev = writeRef(baseDir, 'spec/evidence/memory-mcp-l5/item.json', { ok: true });
  const contractPath = 'packages/mcp-platform/dist/memory/index.d.ts';
  const contractRef = writeRef(baseDir, contractPath, 'export interface MemoryContractV1 {}\n');
  writeRef(baseDir, `retained/${contractPath}`, 'export interface MemoryContractV1 {}\n');
  const invEntry = { path: contractPath, version: '0.4.0', sha256: contractRef.sha256 };
  const invFile = writeRef(baseDir, 'receipts/contract-inventory.json', { contractInventory: [invEntry] });
  const compFile = writeRef(baseDir, 'receipts/contract-comparison.json', {
    identical: true, preCandidateManifestSha256: MANIFEST_SHA, candidateManifestSha256: MANIFEST_SHA, contracts: [invEntry],
  });
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
  const l4BuildFile = writeRef(baseDir, 'receipts/l4-build.json', {
    builtAgainstPreCandidateSha256: MANIFEST_SHA, e4ArtifactSha256: artifacts[0].sha256, sourceHead: C40,
  });
  const graphFile = writeRef(baseDir, 'import-graph.json', {
    roots: PROOF_CATALOG.importGraphRoots, resolvedFilesSha256: H64, forbiddenHits: 0, unresolvedEdges: 0,
  });
  const proofs = PROOF_CATALOG.proofs.map((cat) => {
    const testResults = cat.files.map((file, idx) => ({
      name: file, status: 'passed',
      assertionResults: idx === 0
        ? cat.requiredCases.map((c) => ({ title: c, fullName: c, status: 'passed' }))
        : [{ title: `${cat.id}.extra`, fullName: `${cat.id}.extra`, status: 'passed' }],
    }));
    const executed = testResults.flatMap((tr) => tr.assertionResults.map((ar) => ({ file: tr.name, caseId: ar.fullName, status: 'passed' })));
    const rep = writeRef(baseDir, `results/${cat.id}.json`, {
      success: true, numTotalTests: executed.length, numPassedTests: executed.length, numFailedTests: 0, numPendingTests: 0, numTodoTests: 0, testResults,
    });
    return {
      id: cat.id, files: [...cat.files], command: cat.command,
      result: { path: rep.path, sha256: rep.sha256, format: 'vitest-json', passed: executed.length, failed: 0, skipped: 0, todo: 0, executedCasesSha256: sha256OfBytes(Buffer.from(canonicalizeJson(executed))) },
      artifactManifestSha256: MANIFEST_SHA, sourceHead: C40, runId: '1001', attempt: 1,
    };
  });
  const doc = {
    schemaVersion: 1, checkpoint: 'L5-MEMORY-V1', phase: 'candidate', tupleSha256: H64,
    source: { repository: 'rhanka/sentropic', head: C40, base: C40, merge: C40, checkout: C40, sourceTreeSha256: H64 },
    contracts: {
      specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, l0Freeze: { path: ev.path, sha256: ev.sha256 },
      fixtures: [{ path: ev.path, sha256: ev.sha256 }], registrySha256: H64, gatewaySha256: H64,
      exports: [{ path: ev.path, sha256: ev.sha256 }], schemas: [{ path: ev.path, sha256: ev.sha256 }],
      profiles: [{ path: ev.path, sha256: ev.sha256 }], entry: { path: ev.path, sha256: ev.sha256 }, providerManifest: { path: ev.path, sha256: ev.sha256 },
    },
    preCandidate: {
      manifestSha256: MANIFEST_SHA, contractInventory: { path: invFile.path, sha256: invFile.sha256 },
      l4BuildReceipt: { path: l4BuildFile.path, sha256: l4BuildFile.sha256 }, contractComparison: { path: compFile.path, sha256: compFile.sha256 },
    },
    artifacts,
    closure: {
      artifactManifestSha256: MANIFEST_SHA, declaredLockSha256: H64, installedLockSha256: H64,
      installedClosureSha256: H64, sdkVersion: '1.31.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'],
      referenceExport: '@sentropic/mcp-broker/memory-reference', referenceSourceSha256: H64,
    },
    runtime: {
      nodeVersion: '24.2.0', imageDigest: `node:24-bookworm-slim@sha256:${H64}`, platform: 'linux/amd64', sqliteVersion: '3.49.1',
      driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL', filesystem: 'ext4',
      filesystemAssumptions: 'local-posix-fsync', fenceProfileSha256: H64, pythonCount: 0, addonBuildCount: 0,
    },
    assurance: { productionPolicySha256: H64, qualificationPolicySha256: H64, verifierArtifactSha256: H64, trustProfileSha256: H64, qualificationOnly: true },
    proofs,
    importGraph: { path: graphFile.path, sha256: graphFile.sha256, roots: [...PROOF_CATALOG.importGraphRoots], resolvedFilesSha256: H64, forbiddenHits: 0, unresolvedEdges: 0 },
    ci: {
      workflow: '.github/workflows/ci.yml', runId: '1001', attempt: 1, head: C40, base: C40, merge: C40, checkout: C40,
      imageDigest: `node:24-bookworm-slim@sha256:${H64}`, artifactName: `memory-mcp-l5-${C40}-1001-1`,
      jobs: [{ id: 'memory-l5-qualification', conclusion: 'success', resultSha256: H64 }],
    },
    ownerUat: {}, acceptances: [],
  };
  doc.tupleSha256 = computeTupleSha256(doc);
  const uatRef = writeRef(baseDir, 'receipts/owner-uat.json', {
    tupleSha256: doc.tupleSha256, status: 'passed', policySha256: H64, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z',
  });
  doc.ownerUat = { status: 'passed', evidence: { path: uatRef.path, sha256: uatRef.sha256 }, policySha256: H64, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z' };
  doc.acceptances = ACCEPTANCE_ROLES.map((role) => {
    const accRef = writeRef(baseDir, `receipts/accept-${role}.json`, { role, actorRef: `owner:${role}`, tupleSha256: doc.tupleSha256, verdict: 'accepted' });
    return { role, actorRef: `owner:${role}`, tupleSha256: doc.tupleSha256, verdict: 'accepted', evidence: { path: accRef.path, sha256: accRef.sha256 } };
  });
  return { doc, opts: { baseDir, manifestBytes: MANIFEST_BYTES, execArgv: [], nodeOptions: '' } };
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
