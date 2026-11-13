import { describe, expect, it } from 'vitest';
import { checkWritePath } from '../src/mounts.js';
import { mkdtempSync, mkdirSync, symlinkSync, rmSync, writeFileSync, linkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const scope = { kind: 'ui' as const, writable: ['ui/**', 'packages/{editor,theme}/src/**'],
  refused: ['api/**', '**/package*.json', '**/.npmrc', '**/.yarnrc*', 'ui/dist/**'],
  source: { repo: 'synthetic-test-policy', path: 'tests/scope.test.ts', commit: 'fixture-v1' } };

describe('host-supplied development scope', () => {
  it('should keep generic fixtures independent of tenant registry packages', () => {
    expect(() => checkWritePath('/workspace/packages/editor/src/index.ts', scope)).not.toThrow();
  });
  it('should enforce the registry allowlist and refusals after normalization', () => {
    const check = checkWritePath as (...args: unknown[]) => void;
    for (const path of ['ui/App.ts', 'packages/theme/src/index.ts']) {
      expect(() => check(`/workspace/${path}`, scope)).not.toThrow();
    }
    for (const path of ['../etc/passwd', 'api/a.ts', 'ui/../api/a.ts', 'ui/dist', 'ui/dist/a.js',
      'ui/package-lock.json', 'ui/.npmrc', 'ui/.yarnrc.yml', '.github/workflows/x.yml', 'packages/other/src/a.ts']) {
      expect(() => check(`/workspace/${path}`, scope)).toThrow();
    }
  });
  it('should reject symlink ancestors and absent scope', () => {
    const root = mkdtempSync(join(tmpdir(), 'scope-'));
    const check = checkWritePath as (...args: unknown[]) => void;
    try {
      mkdirSync(join(root, 'ui')); symlinkSync('/etc', join(root, 'ui/link'));
      expect(() => check('/workspace/ui/link/passwd', scope, root)).toThrow();
      writeFileSync(join(root, 'protected'), 'secret'); linkSync(join(root, 'protected'), join(root, 'ui/linked.ts'));
      expect(() => check('/workspace/ui/linked.ts', scope, root)).toThrow();
      expect(() => check('/workspace/ui/a.ts')).toThrow();
    } finally { rmSync(root, { recursive: true }); }
  });
});
