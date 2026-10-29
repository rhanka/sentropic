import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { sha256Hex, sha512Integrity } from '../schema-validator.mjs';
import { validateLot2Manifest, receiveLot2Manifest, E2_SHA256, P3_SHA256 } from '../lot2-manifest.mjs';
import { verifyRetainedP3 } from '../lot2-retained.mjs';
const base = 'spec/evidence/memory-mcp-l5/lot2';
it('should retain independently measured E2/E4 bytes and refuse the unverified receiving fixture', () => {
  const binding = JSON.parse(readFileSync(`${base}/artifact-binding.json`));
  expect(binding.status).toBe('unverified');
  expect(binding.e2.sha256).toBe(E2_SHA256);
  expect(binding.e4.builtAgainstPreCandidateSha256).toBe(P3_SHA256);
  for (const ref of [binding.e2, binding.e4]) {
    const bytes = readFileSync(ref.path);
    expect(sha256Hex(bytes)).toBe(ref.sha256); expect(sha512Integrity(bytes)).toBe(ref.integrity);
  }
  const path = `${base}/fixtures/lot2-manifest.unverified.json`, manifest = JSON.parse(readFileSync(path));
  expect(validateLot2Manifest(manifest, process.cwd())).toContain('manifest: unverified');
  expect(() => receiveLot2Manifest(path, process.cwd())).toThrow('unverified');
  expect(verifyRetainedP3(process.cwd(), 'tools/memory-mcp-l5/artifacts/pre-candidate-manifest.json'))
    .toMatchObject({ retainedOnly: true, qualificationAccepted: false, manifestSha256: P3_SHA256 });
});
