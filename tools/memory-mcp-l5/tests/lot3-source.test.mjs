import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectLot3Files } from '../lot3-source.mjs';
const catalog = JSON.parse(readFileSync(new URL('../proof-catalog-v1.json', import.meta.url)));
describe('Lot 3 exact predecessor inventory', () => {
  it('should retain all 18 P09 suites and require both memory profile suites and mesh context', () => {
    const files = selectLot3Files(catalog);
    expect(files.predecessors).toHaveLength(18);
    expect(files.platform).toContain('tests/memory/wire-profile.test.ts');
    expect(files.mesh).toContain('tests/memory-context.spec.ts');
  });
});
