import { rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { p1Fixture } from './p1-fixture.mjs';
const scan = root => spawnSync(process.execPath, ['tools/memory-mcp-l5/import-graph.mjs', '--mode', 'packed', '--root', root, '--manifest', 'manifest.json'], { encoding: 'utf8' });
describe('immutable manifest packed root gate', () => {
  it('accepts an exact closed P1 fixture', () => {
    const f = p1Fixture(); try { const r = scan(f.root); expect(r.stderr).toBe(''); expect(r.status).toBe(0); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
  it.each(['missing archive', 'corrupt archive', 'wrong digest', 'missing inventory', 'extra inventory', 'wrong inventory digest', 'wrong manifest sidecar'])(
    'refuses %s through the same packed gate', mode => {
      const f = p1Fixture();
      try {
        if (mode === 'missing archive') rmSync(join(f.root, f.manifest.artifacts[0].archive));
        if (mode === 'corrupt archive') f.put(f.manifest.artifacts[0].archive, 'corrupt');
        if (mode === 'wrong digest') f.manifest.artifacts[0].sha256 = '0'.repeat(64);
        if (mode === 'missing inventory') f.manifest.contractInventory.pop();
        if (mode === 'extra inventory') f.manifest.contractInventory.push({ path: 'extra.d.ts', version: '0.4.0', sha256: '0'.repeat(64) });
        if (mode === 'wrong inventory digest') f.manifest.contractInventory[0].sha256 = '0'.repeat(64);
        f.save(); if (mode === 'wrong manifest sidecar') f.put('manifest.json.sha256', `${'0'.repeat(64)}\n`);
        expect(scan(f.root).status).not.toBe(0);
      } finally { rmSync(f.root, { recursive: true, force: true }); }
    },
  );
  it.each([
    { 'dist/memory/index.js': "export * from './barrel.js';", 'dist/memory/barrel.js': "export * from '@sentropic/cluster-mesh/src/index.js';" },
    { 'dist/memory/index.js': "await import('./barrel.js');", 'dist/memory/barrel.js': "await import('@sentropic/mcp-platform/testing');" },
    { 'dist/memory/index.d.ts': "type Hidden = import('./barrel.js').Hidden;", 'dist/memory/barrel.d.ts': "export type { Hidden } from '@sentropic/mcp-platform/mock/oidc';" },
  ])('rejects forbidden packed transitive, dynamic and declaration edges', extra => {
    const f = p1Fixture(extra); try { const r = scan(f.root); expect(r.status).not.toBe(0); expect(r.stderr).toContain('forbidden'); }
    finally { rmSync(f.root, { recursive: true, force: true }); }
  });
});
