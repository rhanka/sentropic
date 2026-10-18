import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  PROOF_IDS,
  ACCEPTANCE_ROLES,
  CHECKPOINT_KEYS,
  FROZEN_SPEC_SHA256,
  sha256OfBytes,
  checkCheckpoint,
} from '../receipt.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'schemas', 'checkpoint-v1.schema.json');
const CATALOG_PATH = join(HERE, '..', 'proof-catalog-v1.json');
const RECEIPT_BIN = join(HERE, '..', 'receipt.mjs');

const H64 = 'a'.repeat(64);
const C40 = 'b'.repeat(40);
const MANIFEST_BYTES = Buffer.from('{"manifestVersion":1}', 'utf8');
const MANIFEST_SHA = sha256OfBytes(MANIFEST_BYTES);

function makeValidCheckpoint() {
  const ev = { path: 'spec/evidence/memory-mcp-l5/item.json', sha256: H64 };
  return {
    schemaVersion: 1,
    checkpoint: 'L5-MEMORY-V1',
    phase: 'candidate',
    tupleSha256: H64,
    source: { repository: 'rhanka/sentropic', head: C40, base: C40, merge: C40, checkout: C40, sourceTreeSha256: H64 },
    contracts: {
      specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, l0Freeze: ev, fixtures: [ev],
      registrySha256: H64, gatewaySha256: H64, exports: [ev], schemas: [ev], profiles: [ev], entry: ev, providerManifest: ev,
    },
    preCandidate: { manifestSha256: MANIFEST_SHA, contractInventory: [ev], l4BuildReceipt: ev, contractComparison: ev },
    artifacts: [{ role: 'l4', name: '@sentropic/engram', version: '0.20.1', sha256: H64, integrity: 'sha512-AAAA==', sourceHead: C40, archiveRef: 'engram.tgz' }],
    closure: {
      artifactManifestSha256: MANIFEST_SHA, declaredLockSha256: H64, installedLockSha256: H64,
      installedClosureSha256: H64, sdkVersion: '1.31.0', sdkRange: '^1.31.0', protocolVersions: ['2025-03-26'],
      referenceExport: '@sentropic/mcp-broker/memory-reference', referenceSourceSha256: H64,
    },
    runtime: {
      nodeVersion: '24.2.0', imageDigest: 'sha256:' + H64, platform: 'linux/amd64', sqliteVersion: '3.49.1',
      driver: 'node:sqlite', journalMode: 'WAL', synchronous: 'FULL', filesystem: 'ext4',
      filesystemAssumptions: 'local-posix-fsync', fenceProfileSha256: H64, pythonCount: 0, addonBuildCount: 0,
    },
    assurance: { productionPolicySha256: H64, qualificationPolicySha256: H64, verifierArtifactSha256: H64, trustProfileSha256: H64, qualificationOnly: true },
    proofs: PROOF_IDS.map((id) => ({
      id, files: [`tests/${id}.test.ts`], command: 'make memory-l5-test ENV=test-feat-memory-mcp-l5',
      result: { path: `results/${id}.json`, sha256: H64, format: 'vitest-json', passed: 4, failed: 0, skipped: 0, todo: 0, executedCasesSha256: H64 },
      artifactManifestSha256: MANIFEST_SHA, sourceHead: C40, runId: '1001', attempt: 1,
    })),
    importGraph: { path: 'import-graph.json', sha256: H64, roots: ['@sentropic/mcp-platform/memory'], resolvedFilesSha256: H64, forbiddenHits: 0, unresolvedEdges: 0 },
    ci: {
      workflow: '.github/workflows/ci.yml', runId: '1001', attempt: 1, head: C40, base: C40, merge: C40, checkout: C40,
      imageDigest: 'sha256:' + H64, artifactName: 'memory-mcp-l5', jobs: [{ id: 'memory-l5-qualification', conclusion: 'success', resultSha256: H64 }],
    },
    ownerUat: { status: 'passed', evidence: ev, policySha256: H64, actorRef: 'owner:antoinefa', recordedAt: '2026-10-18T00:00:00Z' },
    acceptances: ACCEPTANCE_ROLES.map((role) => ({ role, actorRef: `owner:${role}`, tupleSha256: H64, verdict: 'accepted', evidence: ev })),
  };
}

describe('L5 receipt contract and closed checkpoint schema', () => {
  it('aligns schema required keys and catalog P01-P10 with receipt verifier constants', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(CHECKPOINT_KEYS);
    expect(catalog.proofs.map((p) => p.id)).toEqual(PROOF_IDS);
  });

  it('accepts a complete valid checkpoint and rejects extra properties', () => {
    const doc = makeValidCheckpoint();
    const opts = { manifestBytes: MANIFEST_BYTES, l4BuildReceipt: { builtAgainstPreCandidateSha256: MANIFEST_SHA }, contractComparison: { identical: true } };
    expect(checkCheckpoint(doc, opts)).toEqual([]);
    expect(checkCheckpoint({ ...doc, extraBag: {} }, opts)).toContain('checkpoint: extra key extraBag');
  });

  it('rejects missing/duplicate/unknown proofs and skipped/todo/failed test counts', () => {
    const opts = { manifestBytes: MANIFEST_BYTES };
    const missing = makeValidCheckpoint();
    missing.proofs = missing.proofs.slice(0, 9);
    expect(checkCheckpoint(missing, opts).join(' ')).toMatch(/expected exactly 10/);
    const dup = makeValidCheckpoint();
    dup.proofs[9] = { ...dup.proofs[0] };
    expect(checkCheckpoint(dup, opts).join(' ')).toMatch(/missing id P10.*duplicate id P01/);
    const skipped = makeValidCheckpoint();
    skipped.proofs[0].result.skipped = 1;
    expect(checkCheckpoint(skipped, opts).join(' ')).toMatch(/proofs\/P01: invalid vitest-json counts/);
  });

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
