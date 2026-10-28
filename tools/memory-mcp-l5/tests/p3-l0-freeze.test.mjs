import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sha256Hex, verifyOnDiskEvidence } from '../schema-validator.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const freezePath = 'spec/evidence/memory-mcp-l5/l0-freeze.json';
const freezeBytes = readFileSync(join(root, freezePath));
const freeze = JSON.parse(freezeBytes);
const catalog = JSON.parse(readFileSync(join(root, 'tools/memory-mcp-l5/proof-catalog-v1.json')));

function l0Failures(baseDir, path, bytes) {
  const doc = { contracts: {
    specSha256: freeze.specSha256, l0Commit: freeze.l0Commit,
    l0Freeze: { path, sha256: sha256Hex(bytes) },
  } };
  // Exercise the production guard with real frozen bytes, without claiming a full checkpoint.
  return verifyOnDiskEvidence(doc, catalog, { baseDir }).filter(f => f.startsWith('contracts.l0Freeze:'));
}

describe('P3 L0 reissue live catalog/schema binding', () => {
  it('accepts the repository freeze against the actual catalog and schemas', () => {
    expect(l0Failures(root, freezePath, freezeBytes)).toEqual([]);
  });

  it.each([
    ['proofCatalogSha256', 'c8b0f9c8a907eb3d6a42e7a81d7509e6f5149aaf0b9f557842bda928c74c84be'],
    ['artifactManifestSchemaSha256', '4a43a66928c3000cdf48fe72c242e2d9cfbd2b3cc153851e9650ebc6c0cd9d8c'],
  ])('rejects stale %s even when the freeze file digest matches', (field, staleHash) => {
    const dir = mkdtempSync(join(tmpdir(), 'memory-p3-l0-'));
    try {
      const bytes = Buffer.from(JSON.stringify({ ...freeze, [field]: staleHash }));
      writeFileSync(join(dir, 'freeze.json'), bytes);
      expect(l0Failures(dir, 'freeze.json', bytes)).toEqual([
        'contracts.l0Freeze: freeze metadata or schema/catalog hash mismatch',
      ]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
