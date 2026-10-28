import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('comments module — export surface registration', () => {
  const PACKAGE_ROOT = process.cwd();
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
  ) as { version: string; exports: Record<string, unknown> };
  const manifest = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_ROOT, 'export-manifest.json'), 'utf8'),
  ) as { _version: string; subpaths: Record<string, unknown> };

  it('should export the ./comments subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain('./comments');
  });

  it('should list ./comments in export-manifest.json subpaths', () => {
    expect(Object.keys(manifest.subpaths)).toContain('./comments');
  });

  it('should export CommentsPanel.svelte subpath in package.json', () => {
    expect(Object.keys(pkgJson.exports)).toContain('./comments/CommentsPanel.svelte');
  });

  it('should not export orphan comment sub-components (CommentsPanel is the canonical surface)', () => {
    // CommentTimeline/CommentComposer/CommentThreadNav were removed in 0.19.0:
    // never consumed by sentropic nor parity-proven (no-orphan gate). Re-export
    // only when CommentsPanel composes them or a consumer/parity harness lands.
    expect(Object.keys(pkgJson.exports)).not.toContain('./comments/CommentTimeline.svelte');
    expect(Object.keys(pkgJson.exports)).not.toContain('./comments/CommentComposer.svelte');
    expect(Object.keys(pkgJson.exports)).not.toContain('./comments/CommentThreadNav.svelte');
  });

  it('should resolve the comments index source file to an existing path', () => {
    const entry = pkgJson.exports['./comments'] as Record<string, string>;
    const file = entry['import'] ?? entry['types'];
    expect(file).toBeTruthy();
    const abs = path.resolve(PACKAGE_ROOT, file as string);
    expect(fs.existsSync(abs)).toBe(true);
  });

  it('should resolve CommentsPanel.svelte source to an existing path', () => {
    const entry = pkgJson.exports['./comments/CommentsPanel.svelte'] as Record<string, string>;
    const file = entry['svelte'] ?? entry['import'];
    expect(file).toBeTruthy();
    expect(fs.existsSync(path.resolve(PACKAGE_ROOT, file as string))).toBe(true);
  });

  it('should resolve CommentsPanel.svelte.d.ts type file to an existing path', () => {
    const entry = pkgJson.exports['./comments/CommentsPanel.svelte'] as Record<string, string>;
    const file = entry['types'];
    expect(file).toBeTruthy();
    expect(fs.existsSync(path.resolve(PACKAGE_ROOT, file as string))).toBe(true);
  });
});
