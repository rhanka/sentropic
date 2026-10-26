import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectLot3Files, validateLot3Report } from '../lot3-source.mjs';
import { catalogDispositions, WAITING_FOR, PLATFORM_BLOCKED_CASES } from '../lot3-dispositions.mjs';
const catalog = JSON.parse(readFileSync(new URL('../proof-catalog-v1.json', import.meta.url)));
describe('Lot 3 exact predecessor inventory', () => {
  it('should retain all 18 P09 suites without selecting blocked platform profiles or mesh context', () => {
    const files = selectLot3Files(catalog);
    expect(files.predecessors).toHaveLength(18);
    expect(files.platform).not.toContain('tests/memory/wire-profile.test.ts');
    expect(files.platform).not.toContain('tests/memory/schema-profile.test.ts');
    expect(files.mesh).not.toContain('tests/memory-context.spec.ts');
    expect(files.platform).toContain('tests/memory/confirmation.test.ts');
  });
  it('should refuse missing or duplicate predecessor mappings', () => {
    for (const change of [files => files.pop(), files => { files[0] = files[1]; }]) {
      const mutated = structuredClone(catalog); change(mutated.proofs.find(p => p.id === 'P09').files);
      expect(() => selectLot3Files(mutated)).toThrow();
    }
  });
  it('should report every catalog file and case, including absent packed and other-gate items', () => {
    const rows = catalogDispositions(catalog, file => !file.includes('/packed/'));
    for (const proof of catalog.proofs) {
      expect(rows.filter(row => row.id === proof.id).map(row => row.file)).toEqual(proof.files);
      expect(new Set(rows.filter(row => row.id === proof.id).flatMap(row => row.cases))).toEqual(new Set(proof.requiredCases));
    }
    expect(rows.filter(row => row.file.includes('/packed/')).every(row => row.status !== 'run-here' && !row.present)).toBe(true);
    const blocked = rows.filter(row => row.status === 'blocked: platform-admitBridgeTools');
    expect(blocked.flatMap(row => row.cases).sort()).toEqual([...PLATFORM_BLOCKED_CASES].sort());
    expect(blocked.every(row => row.disposition === 'blocked: platform-admitBridgeTools')).toBe(true);
    expect(rows.filter(row => row.file.startsWith('packages/mcp-broker/')).every(row => row.status === 'out-of-lot')).toBe(true);
    expect(WAITING_FOR.filter(row => !row.status).map(row => row.id)).toEqual(['P01.packed', 'P02.packed', 'P03', 'P04.packed', 'P05', 'P06', 'P07', 'P08', 'P10']);
    expect(WAITING_FOR.filter(row => row.status).map(row => row.id)).toEqual(PLATFORM_BLOCKED_CASES);
  });
  it('should fail on undisposed files, cases, proofs or missing in-lot files', () => {
    expect(() => catalogDispositions(catalog, () => false)).toThrow();
    for (const mutate of [c => c.proofs.pop(), c => c.proofs[0].requiredCases.push('P01.unknown'),
      c => { c.proofs[0].files.push('foreign.test'); c.proofs[0].fileCases['foreign.test'] = [c.proofs[0].requiredCases[0]]; },
      c => { delete c.proofs[0].fileCases[c.proofs[0].files[0]]; }]) {
      const changed = structuredClone(catalog); mutate(changed);
      expect(() => catalogDispositions(changed, () => true)).toThrow();
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
