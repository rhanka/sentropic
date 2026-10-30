import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('ChatConversation — export surface registration', () => {
  const PACKAGE_ROOT = process.cwd();
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { version: string; exports: Record<string, unknown> };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'export-manifest.json'), 'utf8'),
  ) as { _version: string; subpaths: Record<string, unknown> };

  const SUBPATH = './components/ChatConversation.svelte';

  it('should export the ChatConversation subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain(SUBPATH);
  });

  it('should list ChatConversation in export-manifest.json subpaths', () => {
    expect(Object.keys(manifest.subpaths)).toContain(SUBPATH);
  });

  it('should have version 1.0.0 in package.json', () => {
    expect(pkgJson.version).toBe('1.0.0');
  });

  it('should have _version 1.0.0 in export-manifest.json', () => {
    expect(manifest._version).toBe('1.0.0');
  });

  it('should resolve the ChatConversation svelte file to an existing path', () => {
    const entry = pkgJson.exports[SUBPATH] as Record<string, string>;
    const file = entry['svelte'] ?? entry['import'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('should resolve the ChatConversation .d.ts file to an existing path', () => {
    const entry = pkgJson.exports[SUBPATH] as Record<string, string>;
    const file = entry['types'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });
});
