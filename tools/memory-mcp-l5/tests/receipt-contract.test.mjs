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
const makeValidCheckpoint = () => buildCheckpointBundle(mkdtempSync(join(tmpdir(), 'l5-cp-'))).doc;

describe('L5 receipt contract and closed checkpoint schema', () => {
  it('rejects mutated pre-candidate bytes, wrong E4 build binding, changed contracts, and cross-digest proof reuse', () => {
    const doc = makeValidCheckpoint();
    expect(checkCheckpoint(doc, { manifestBytes: Buffer.from('mutated') }).join(' ')).toMatch(/preCandidate\.manifestSha256/);
    expect(checkCheckpoint(doc, { manifestBytes: MANIFEST_BYTES, l4BuildReceipt: { builtAgainstPreCandidateSha256: H64 } }).join(' ')).toMatch(/builtAgainstPreCandidateSha256 mismatch/);
    expect(checkCheckpoint(doc, { manifestBytes: MANIFEST_BYTES, contractComparison: { identical: false } }).join(' ')).toMatch(/contract bytes or inventory changed/);
    const cross = makeValidCheckpoint();
    cross.proofs[2].artifactManifestSha256 = H64;
    expect(checkCheckpoint(cross, { manifestBytes: MANIFEST_BYTES }).join(' ')).toMatch(/proofs\/P03: cross-digest proof reuse/);
  });

  it('rejects below-floor Node, flag-dependent SQLite, import-graph hits, failed CI jobs, and invalid owner/acceptance records', () => {
    const opts = { manifestBytes: MANIFEST_BYTES };
    const badRt = makeValidCheckpoint();
    badRt.runtime.nodeVersion = '22.12.0';
    expect(checkCheckpoint(badRt, opts).join(' ')).toMatch(/below floor/);
    expect(checkCheckpoint(makeValidCheckpoint(), { ...opts, execArgv: ['--experimental-sqlite'] }).join(' ')).toMatch(/flag-dependent SQLite/);
    const badGraph = makeValidCheckpoint();
    badGraph.importGraph.forbiddenHits = 1;
    expect(checkCheckpoint(badGraph, opts).join(' ')).toMatch(/importGraph/);
    const badUat = makeValidCheckpoint();
    badUat.ownerUat = { status: 'owner-deferred', owningLot: 'L5' };
    badUat.acceptances = badUat.acceptances.slice(0, 3);
    expect(checkCheckpoint(badUat, opts).join(' ')).toMatch(/ownerUat.*missing transport/s);
  });

  it('runs preflight and checkpoint CLI modes without downgrading missing proof', () => {
    const dir = mkdtempSync(join(tmpdir(), 'l5-receipt-'));
    try {
      const cpFile = join(dir, 'checkpoint.json'), mfFile = join(dir, 'manifest.json');
      writeFileSync(cpFile, JSON.stringify(makeValidCheckpoint()));
      writeFileSync(mfFile, MANIFEST_BYTES);
      const pre = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'preflight', '--checkpoint', cpFile], { encoding: 'utf8' });
      expect(pre.status).toBe(0);
      expect(JSON.parse(pre.stdout).accepted).toBe(false);
      const fail = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', cpFile], { encoding: 'utf8' });
      expect(fail.status).toBe(1);
      const pass = spawnSync(process.execPath, [RECEIPT_BIN, '--mode', 'checkpoint', '--checkpoint', cpFile, '--manifest', mfFile], { encoding: 'utf8' });
      expect(pass.status).toBe(0);
      expect(JSON.parse(pass.stdout).accepted).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
