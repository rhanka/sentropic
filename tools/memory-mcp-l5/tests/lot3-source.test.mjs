import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectLot3Files, validateLot3Report } from '../lot3-source.mjs';
const catalog = JSON.parse(readFileSync(new URL('../proof-catalog-v1.json', import.meta.url)));
describe('Lot 3 exact predecessor inventory', () => {
  it('should retain all 18 P09 suites and require both memory profile suites and mesh context', () => {
    const files = selectLot3Files(catalog);
    expect(files.predecessors).toHaveLength(18);
    expect(files.platform).toContain('tests/memory/wire-profile.test.ts');
    expect(files.mesh).toContain('tests/memory-context.spec.ts');
  });
  it('should refuse missing or duplicate predecessor mappings', () => {
    for (const change of [files => files.pop(), files => { files[0] = files[1]; }]) {
      const mutated = structuredClone(catalog); change(mutated.proofs.find(p => p.id === 'P09').files);
      expect(() => selectLot3Files(mutated)).toThrow();
    }
  });
  it('should refuse missing files and skipped/todo case reports', () => {
    const report = { success: true, numPassedTests: 1, testResults: [{ name: '/pkg/test.ts', status: 'passed',
      assertionResults: [{ status: 'passed' }] }] };
    expect(() => validateLot3Report(report, ['test.ts'], '/pkg')).not.toThrow();
    expect(() => validateLot3Report(report, ['missing.ts'], '/pkg')).toThrow();
    for (const status of ['pending', 'todo', 'skipped', 'failed']) {
      expect(() => validateLot3Report({ ...report, testResults: [{ ...report.testResults[0],
        assertionResults: [{ status }] }] }, ['test.ts'], '/pkg')).toThrow();
    }
  });
});
