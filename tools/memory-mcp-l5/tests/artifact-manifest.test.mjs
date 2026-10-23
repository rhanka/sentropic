import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { checkArtifactManifest, hasPathTraversal, hasExternalSourceAlias, isSha512Integrity, FROZEN_SPEC_SHA256 } from '../receipt.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'schemas', 'artifact-manifest-v1.schema.json');
const H64 = 'c'.repeat(64);
const C40 = 'b'.repeat(40);
const S512 = 'sha512-' + 'A'.repeat(86) + '==';

function makeValidPreCandidateManifest() {
  return {
    manifestVersion: 1,
    stage: 'pre-candidate',
    source: { specSha256: FROZEN_SPEC_SHA256, l0Commit: C40, br3Commit: C40, l5Head: C40, sdkRange: '^1.31.0', declaredLockSha256: H64, lockFingerprintVersion: 4, lockFingerprint: H64, declaredLockSnapshot: { path: `lock-snapshots/${H64}.package-lock.json`, sha256: H64 }, toolchainSnapshots: [{ path: 'tools/memory-mcp-l5/artifacts/toolchain/toolchain.package-lock.json', sha256: H64 }, { path: 'tools/memory-mcp-l5/artifacts/toolchain/toolchain.package.json', sha256: H64 }] },
    artifacts: [
      { role: 'platform', name: '@sentropic/mcp-platform', version: '0.4.0', sha256: H64, integrity: S512, sourceHead: C40, archive: 'archives/mcp-platform-0.4.0.tgz' },
      { role: 'broker', name: '@sentropic/mcp-broker', version: '0.2.0', sha256: H64, integrity: S512, sourceHead: C40, archive: 'archives/mcp-broker-0.2.0.tgz' },
    ],
    contractInventory: [
      { path: 'packages/mcp-platform/dist/memory/index.d.ts', version: '0.4.0', sha256: H64 },
      { path: 'packages/mcp-broker/dist/memory/index.d.ts', version: '0.2.0', sha256: H64 },
      { path: 'tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json', version: '1.0.0', sha256: H64 },
    ],
  };
}

function makeValidCandidateManifest() {
  const pre = makeValidPreCandidateManifest();
  return {
    ...pre,
    stage: 'candidate',
    preCandidateManifestSha256: H64,
    e4ArtifactSha256: H64,
    l4BuildReceipt: { path: 'receipts/l4-build.json', sha256: H64 },
    artifacts: [
      ...pre.artifacts,
      { role: 'l4', name: '@sentropic/engram', version: '0.20.1', sha256: H64, integrity: S512, sourceHead: C40, archive: 'archives/engram-0.20.1.tgz' },
      { role: 'mesh', name: '@sentropic/cluster-mesh', version: '0.19.0', sha256: H64, integrity: S512, sourceHead: C40, archive: 'archives/cluster-mesh-0.19.0.tgz' },
    ],
  };
}

describe('P10.tooling.artifact-manifest — L5 artifact-manifest schema and verifier', () => {
  it('P10.tooling.artifact-manifest: enforces closed acyclic JSON Schema draft 2020-12 with stage-specific oneOf and finite bounds', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(Array.isArray(schema.oneOf)).toBe(true);
    expect(schema.oneOf).toHaveLength(3);
    for (const branch of schema.oneOf) expect(branch.additionalProperties).toBe(false);
    const candBranch = schema.oneOf.find((b) => b.properties?.stage?.const === 'candidate');
    expect('contractComparison' in candBranch.properties).toBe(false);
    expect(schema.$defs.artifactItem.additionalProperties).toBe(false);
    expect(schema.$defs.contractEntry.required).toEqual(['path', 'version', 'sha256']);
  });

  it('P10.tooling.artifact-manifest: accepts valid closed pre-candidate, lot2, and acyclic candidate manifests', () => {
    const pre = makeValidPreCandidateManifest();
    expect(checkArtifactManifest(pre, { retainedContractInventory: structuredClone(pre.contractInventory) })).toEqual([]);
    const lot2 = {
      ...pre,
      stage: 'lot2',
      preCandidateManifestSha256: H64,
      e2ArtifactSha256: H64,
      e2Provenance: { path: 'receipts/e2-provenance.json', sha256: H64 },
      artifacts: [...pre.artifacts, { role: 'e2', name: '@sentropic/engram', version: '0.20.0', sha256: H64, integrity: S512, sourceHead: C40, archive: 'archives/engram-0.20.0.tgz' }],
    };
    expect(checkArtifactManifest(lot2)).toEqual([]);
    expect(checkArtifactManifest(makeValidCandidateManifest())).toEqual([]);
  });

  it('P10.tooling.artifact-manifest: rejects duplicate names/archives/paths, root/nested/prototype extra keys, stage role mismatches, and malformed shapes', () => {
    const dupPkg = makeValidPreCandidateManifest();
    dupPkg.artifacts.push({ ...dupPkg.artifacts[0], archive: 'archives/other.tgz' });
    expect(checkArtifactManifest(dupPkg).join(' ')).toMatch(/duplicate name @sentropic\/mcp-platform/);

    const dupArch = makeValidPreCandidateManifest();
    dupArch.artifacts.push({ ...dupArch.artifacts[0], name: '@sentropic/other', role: 'dependency' });
    expect(checkArtifactManifest(dupArch).join(' ')).toMatch(/duplicate archive/);

    const nestedExtra = makeValidPreCandidateManifest();
    nestedExtra.artifacts[0].extraBag = 1;
    expect(checkArtifactManifest(nestedExtra).join(' ')).toMatch(/additional property extraBag forbidden/);

    const protoCtor = makeValidPreCandidateManifest();
    protoCtor.source = JSON.parse(JSON.stringify(protoCtor.source).replace(/\}$/, ',"constructor":{"unexpected":true}}'));
    expect(checkArtifactManifest(protoCtor).join(' ')).toMatch(/additional property constructor forbidden/);

    const protoUnder = makeValidPreCandidateManifest();
    protoUnder.source = JSON.parse(JSON.stringify(protoUnder.source).replace(/\}$/, ',"__proto__":{"alsoUnexpected":true}}'));
    expect(checkArtifactManifest(protoUnder).join(' ')).toMatch(/additional property __proto__ forbidden/);

    const badCand = makeValidCandidateManifest();
    badCand.artifacts[2].role = 'dependency';
    expect(checkArtifactManifest(badCand).join(' ')).toMatch(/candidate requires exactly one l4 artifact/);

    expect(checkArtifactManifest({ manifestVersion: 1, stage: 'pre-candidate', source: null, artifacts: {}, contractInventory: null }).length).toBeGreaterThan(0);
  });

  it('P10.tooling.artifact-manifest: rejects path traversal, absolute/URL paths, external source aliases, and short sha512 integrities', () => {
    expect(hasPathTraversal('../outside.tgz')).toBe(true);
    expect(hasPathTraversal('/abs/path.tgz')).toBe(true);
    expect(hasPathTraversal('https://evil.example/pkg.tgz')).toBe(true);
    expect(hasExternalSourceAlias('file:../mcp-platform')).toBe(true);
    expect(hasExternalSourceAlias('workspace:*')).toBe(true);
    expect(isSha512Integrity('sha512-A')).toBe(false);
    expect(isSha512Integrity(S512)).toBe(true);

    const bad = makeValidPreCandidateManifest();
    bad.artifacts[0].version = 'file:../mcp-platform';
    bad.artifacts[1].archive = 'https://evil.example/escape.tgz';
    bad.artifacts[1].integrity = 'sha512-A';
    bad.contractInventory[0].sha256 = 'SHORT';
    const errs = checkArtifactManifest(bad).join(' ');
    expect(errs).toMatch(/manifest\.artifacts\/@sentropic\/mcp-platform/);
    expect(errs).toMatch(/manifest\.artifacts\/@sentropic\/mcp-broker/);
    expect(errs).toMatch(/manifest\.contractInventory/);
  });

  it('P10.tooling.artifact-manifest: rejects mutated or missing contract inventory entries against the retained pre-candidate', () => {
    const manifest = makeValidCandidateManifest();
    const mutated = structuredClone(manifest.contractInventory);
    mutated[0].sha256 = 'd'.repeat(64);
    expect(checkArtifactManifest(manifest, { retainedContractInventory: mutated }).join(' ')).toMatch(/differs from retained pre-candidate/);
  });
});
