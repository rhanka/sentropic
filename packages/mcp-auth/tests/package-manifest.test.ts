import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('published package manifest', () => {
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    it(`should reject local references in ${section}`, () => {
      for (const [name, version] of Object.entries(manifest[section] ?? {})) {
        expect(version, `${section}.${name}`).not.toMatch(/^(file:|workspace:|link:|\.\.\/)/);
      }
    });
  }

  it('should resolve oauth-verify from the local workspace for package tests', () => {
    expect(realpathSync(fileURLToPath(new URL('../node_modules/@sentropic/oauth-verify', import.meta.url))))
      .toBe(realpathSync(fileURLToPath(new URL('../../oauth-verify', import.meta.url))));
  });

  it('should preserve registry dependencies in the packed manifest', () => {
    const destination = mkdtempSync(join(tmpdir(), 'mcp-auth-pack-'));
    try {
      const output = execFileSync('npm', [
        'pack', '--json', '--ignore-scripts', '--workspaces=false', '--pack-destination', destination,
      ], { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8' });
      const [{ filename }] = JSON.parse(output);
      const packed = JSON.parse(execFileSync('tar', [
        '-xOf', join(destination, filename), 'package/package.json',
      ], { encoding: 'utf8' }));
      expect(packed.version).toBe(manifest.version);
      expect(packed.dependencies).toEqual({ '@sentropic/oauth-verify': '^0.1.0' });
      expect(packed.peerDependencies).toEqual(manifest.peerDependencies);
      expect(packed.optionalDependencies).toEqual(manifest.optionalDependencies);
      console.log('PACKED package.json dependencies:', JSON.stringify(packed.dependencies, null, 2));
    } finally {
      rmSync(destination, { recursive: true, force: true });
    }
  });
});
