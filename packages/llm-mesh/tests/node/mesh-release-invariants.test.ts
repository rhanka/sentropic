import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const repoRoot = (path: string): string =>
  new URL(`../../../../${path}`, import.meta.url).pathname;
const packageFile = (path: string): string =>
  new URL(`../../${path}`, import.meta.url).pathname;

// Automated release invariants for the CI seat work (R6-1): exactly one
// linked llm-mesh copy in the workspace lock, the mesh version inside the
// gateway's declared range, and the seat surfaces wired on both entries.

describe('mesh release invariants', () => {
  it('holds exactly one linked llm-mesh copy in the workspace lock', async () => {
    const lock = JSON.parse(await readFile(repoRoot('package-lock.json'), 'utf8')) as {
      packages: Record<string, { link?: boolean }>;
    };
    const meshCopies = Object.keys(lock.packages).filter((key) =>
      key === 'node_modules/@sentropic/llm-mesh' || key.endsWith('/node_modules/@sentropic/llm-mesh'),
    );
    expect(meshCopies).toEqual(['node_modules/@sentropic/llm-mesh']);
    expect(lock.packages['node_modules/@sentropic/llm-mesh']?.link).toBe(true);
  });

  it('keeps the mesh version inside the gateway declared range', async () => {
    const mesh = JSON.parse(await readFile(packageFile('package.json'), 'utf8')) as { version: string };
    const gateway = JSON.parse(await readFile(repoRoot('packages/llm-gateway/package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    };
    const range = gateway.dependencies['@sentropic/llm-mesh'];
    // Current main declares a union of caret ranges; the mesh version must satisfy one.
    const ranges = (range ?? '').split('||').map((s) => s.trim()).filter((s) => /^\^\d+\.\d+\.\d+$/.test(s));
    expect(ranges.length).toBeGreaterThan(0);
    const [major, minor, patch] = mesh.version.split('.').map(Number);
    const admitted = ranges.some((r) => {
      const caret = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(r)!;
      const cMajor = Number(caret[1]); const cMinor = Number(caret[2]); const cPatch = Number(caret[3]);
      if (cMajor > 0) return major === cMajor && (minor > cMinor || (minor === cMinor && patch >= cPatch));
      // Caret rule for 0.x: same minor, any patch.
      return major === 0 && minor === cMinor;
    });
    expect(admitted).toBe(true);
  });

  it('wires the seat surfaces on the enrollment and node entries', async () => {
    const enrollment = await import('../../src/enrollment/index.js');
    const node = await import('../../src/node/index.js');
    expect(typeof enrollment.parseCliSeatProfile).toBe('function');
    expect(typeof enrollment.translateAgySeatToApplication).toBe('function');
    expect(typeof enrollment.persistAgySeatProjection).toBe('function');
    expect(typeof node.inspectSeatStoreRecord).toBe('function');
    expect(typeof node.markExternalSeatAuthority).toBe('function');
    expect(typeof node.SeatSidecarFileBackend).toBe('function');
  });
});
