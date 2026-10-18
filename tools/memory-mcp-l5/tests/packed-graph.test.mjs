import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const scanner = join(process.cwd(), 'tools/memory-mcp-l5/import-graph.mjs');
const run = args => spawnSync(process.execPath, [scanner, ...args], { encoding: 'utf8' });
describe('actual graph scanner', () => {
  it('fails packed mode when its mandatory immutable manifest is missing', () => {
    const result = run(['--mode', 'packed', '--manifest', '/DOES-NOT-EXIST']);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/manifest|ENOENT/i);
  });
  it.each([
    "export * from './barrel.js';", "await import('./barrel.js');",
    "import type { Hidden } from './barrel.js';", "type Hidden = import('./barrel.js').Hidden;",
  ])('traverses real transitive/runtime/type/dynamic graphs: %s', source => {
    const root = mkdtempSync(join(tmpdir(), 'l5-graph-'));
    try {
      mkdirSync(join(root, 'src'));
      writeFileSync(join(root, 'src/index.ts'), source);
      writeFileSync(join(root, 'src/barrel.ts'), "export * from '@sentropic/cluster-mesh/src/compose/mcp.js';");
      const result = run(['--mode', 'fixture', '--root', root, '--entry', 'src/index.ts']);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('forbidden');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('accepts a complete safe graph through the same scanner', () => {
    const root = mkdtempSync(join(tmpdir(), 'l5-graph-'));
    try {
      writeFileSync(join(root, 'index.ts'), "export * from './safe.js';");
      writeFileSync(join(root, 'safe.ts'), 'export const safe = true;');
      expect(run(['--mode', 'fixture', '--root', root, '--entry', 'index.ts']).status).toBe(0);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
