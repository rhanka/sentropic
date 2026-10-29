import { expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readCandidateInput } from '../candidate.mjs';
import { sha256 } from '../precandidate.mjs';
it('P08.packed.disabled-install: ordinary install and unselected root/metadata imports activate no memory', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = JSON.parse(readFileSync(process.env.DISABLED_INSTALL_RESULT!, 'utf8'));
  const manifest = readCandidateInput(root, process.env.ARTIFACT_MANIFEST);
  expect(result.artifactManifestSha256).toBe(sha256(manifest));
  expect(result.candidateSha256).toBe(JSON.parse(manifest.toString()).e4ArtifactSha256);
  expect(result.observerSha256).toBe(sha256(readCandidateInput(root, 'tools/memory-mcp-l5/disabled-trace.mjs')));
  expect(result.predicateSha256).toBe(sha256(readCandidateInput(root, 'tools/memory-mcp-l5/native-build.mjs')));
  expect(result.scriptsEnabled).toBe(true);
  expect(result.optionalDependenciesEnabled).toBe(true);
  expect(result.installExit).toBe(0);
  expect(result.evidence).toHaveLength(4);
  for (const evidence of result.evidence) {
    expect(sha256(readCandidateInput(root, evidence.path))).toBe(evidence.sha256);
  }
  expect(result.passed).toBe(true);
  expect(result.positiveControlBuilds).toBeGreaterThan(0);
  expect(result.nativeBuilds).toEqual([]);
  expect(result.runtimeCounts).toEqual({ 'provider-load': 0, 'store-open': 0, 'identity-bootstrap': 0, 'native-build': 0 });
});
