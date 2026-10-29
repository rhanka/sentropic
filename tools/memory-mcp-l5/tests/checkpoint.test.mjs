import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { produceCheckpoint } from '../checkpoint.mjs';
import { writeImmutable } from '../candidate.mjs';
it('retains a rejected incomplete proposal without inventing owner, CI or acceptance provenance', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-checkpoint-')), head = 'a'.repeat(40);
  try {
    // Deliberately invalid negative fixture, never an acceptance example.
    const manifest = 'tools/memory-mcp-l5/artifacts/candidate-manifest.json';
    const ref = writeImmutable(root, manifest, { stage: 'candidate', source: { l5Head: head },
      preCandidateManifestSha256: 'b'.repeat(64), artifacts: [], contractInventory: [] });
    const path = 'spec/evidence/memory-mcp-l5/r5-checkpoint.json';
    const input = { binding: { sourceHead: head, artifactManifestSha256: ref.sha256,
      command: 'make fixture ENV=test-memory-l5', runId: 'local', attempt: 0 }, reports: [], observed: {} };
    const result = produceCheckpoint(root, path, manifest, input);
    expect(result.accepted).toBe(false);
    expect(result.verdict).toBe('NOT QUALIFIED');
    expect(result.failures.length).toBeGreaterThan(10);
    const doc = JSON.parse(readFileSync(join(root, path)));
    for (const key of ['ci', 'ownerUat', 'acceptances']) expect(doc).not.toHaveProperty(key);
    expect(doc.proofs).toHaveLength(10);
    expect(doc.proofs.every(p => p.result.passed === 0)).toBe(true);
    expect(() => produceCheckpoint(root, path, manifest, { ...input,
      binding: { ...input.binding, sourceHead: 'c'.repeat(40) } })).toThrow(/binding mismatch/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
