import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { checkArtifactManifest, hasPathTraversal, hasExternalSourceAlias } from '../receipt.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SCHEMA_PATH = join(HERE, '..', 'schemas', 'artifact-manifest-v1.schema.json');
const H64 = 'c'.repeat(64);

function makeValidManifest() {
  return {
    manifestVersion: 1,
    artifacts: [
      { name: '@sentropic/mcp-platform', version: '0.4.0', sha256: H64, integrity: 'sha512-BBBB==', archive: 'archives/mcp-platform-0.4.0.tgz' },
      { name: '@sentropic/mcp-broker', version: '0.2.0', sha256: H64, integrity: 'sha512-CCCC==', archive: 'archives/mcp-broker-0.2.0.tgz' },
    ],
    contractInventory: [
      { path: 'packages/mcp-platform/dist/memory/index.d.ts', sha256: H64 },
      { path: 'packages/mcp-broker/dist/memory/index.d.ts', sha256: H64 },
      { path: 'tools/memory-mcp-l5/schemas/checkpoint-v1.schema.json', sha256: H64 },
    ],
  };
}

describe('L5 artifact-manifest schema and verifier', () => {
  it('enforces closed JSON Schema draft 2020-12 on artifact-manifest-v1.schema.json', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(['manifestVersion', 'artifacts', 'contractInventory']);
    expect(schema.properties.artifacts.items.additionalProperties).toBe(false);
    expect(schema.properties.contractInventory.items.additionalProperties).toBe(false);
  });

  it('accepts a valid closed manifest and matching retained pre-candidate contract inventory', () => {
    const manifest = makeValidManifest();
    expect(checkArtifactManifest(manifest, { retainedContractInventory: structuredClone(manifest.contractInventory) })).toEqual([]);
  });

  it('rejects duplicate package names, duplicate archives, duplicate contract paths, and extra keys', () => {
    const dupPkg = makeValidManifest();
    dupPkg.artifacts.push({ ...dupPkg.artifacts[0], archive: 'archives/other.tgz' });
    expect(checkArtifactManifest(dupPkg).join(' ')).toMatch(/duplicate name @sentropic\/mcp-platform/);

    const dupArch = makeValidManifest();
    dupArch.artifacts.push({ ...dupArch.artifacts[0], name: '@sentropic/other' });
    expect(checkArtifactManifest(dupArch).join(' ')).toMatch(/duplicate archive/);

    const dupContract = makeValidManifest();
    dupContract.contractInventory.push({ ...dupContract.contractInventory[0] });
    expect(checkArtifactManifest(dupContract).join(' ')).toMatch(/duplicate path/);

    expect(checkArtifactManifest({ ...makeValidManifest(), extra: true })).toContain('manifest: extra key extra');
  });

  it('rejects path traversal, external source aliases, and bad digests/integrities', () => {
    expect(hasPathTraversal('../outside.tgz')).toBe(true);
    expect(hasPathTraversal('/abs/path.tgz')).toBe(true);
    expect(hasExternalSourceAlias('file:../mcp-platform')).toBe(true);
    expect(hasExternalSourceAlias('workspace:*')).toBe(true);

    const bad = makeValidManifest();
    bad.artifacts[0].version = 'file:../mcp-platform';
    bad.artifacts[1].archive = '../escape.tgz';
    bad.contractInventory[0].sha256 = 'SHORT';
    const errs = checkArtifactManifest(bad).join(' ');
    expect(errs).toMatch(/manifest\.artifacts\/@sentropic\/mcp-platform/);
    expect(errs).toMatch(/manifest\.artifacts\/@sentropic\/mcp-broker/);
    expect(errs).toMatch(/manifest\.contractInventory/);
  });

  it('rejects mutated or missing contract inventory entries against the retained pre-candidate', () => {
    const manifest = makeValidManifest();
    const mutated = structuredClone(manifest.contractInventory);
    mutated[0].sha256 = 'd'.repeat(64);
    expect(checkArtifactManifest(manifest, { retainedContractInventory: mutated }).join(' ')).toMatch(/differs from retained pre-candidate/);
  });
});
