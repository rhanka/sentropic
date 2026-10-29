import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkArtifactManifest } from '../receipt.mjs';
import { sha256Hex } from '../schema-validator.mjs';
import { validateLot2Manifest, P3_SHA256, E2_SHA256 } from '../lot2-manifest.mjs';
it('should receive the existing frozen Lot 2 envelope and keep unverified provenance blocked', () => {
  const pre = JSON.parse(readFileSync('tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'));
  const path = 'spec/evidence/memory-mcp-l5/lot2/fixtures/lot2-provenance.unverified.json';
  const binding = JSON.parse(readFileSync('spec/evidence/memory-mcp-l5/lot2/artifact-binding.json'));
  const manifest = { manifestVersion: 1, stage: 'lot2', preCandidateManifestSha256: P3_SHA256,
    e2ArtifactSha256: E2_SHA256, e2Provenance: { path, sha256: sha256Hex(readFileSync(path)) },
    source: pre.source, contractInventory: pre.contractInventory, artifacts: [...pre.artifacts,
      { role: 'e2', name: binding.e2.name, version: binding.e2.version, sha256: binding.e2.sha256,
        integrity: binding.e2.integrity, archive: binding.e2.path, sourceHead: '5a8018e35f895995ae0299021aa4902dbd45cdcc' }] };
  expect(checkArtifactManifest(manifest)).toEqual([]);
  expect(validateLot2Manifest(manifest, process.cwd())).toContain('manifest: unverified');
});
