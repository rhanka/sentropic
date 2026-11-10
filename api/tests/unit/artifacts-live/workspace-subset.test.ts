import { describe, expect, it } from 'vitest';
import {
  declaredWorkspaceDirs, isSafeWorkspaceName, parseInstallWorkspaces, subsetLockPaths, validateWorkspaces,
} from '../../../src/services/artifacts/live/workspace-subset';

/** Fixture monorepo: root workspaces ["api","ui","packages/*"], one root lockfile. */
export const MONO_ROOT = JSON.stringify({ name: 'radar', version: '1.0.0', workspaces: ['api', 'ui', 'packages/*'] });
const pkg = (name: string, dependencies: Record<string, string> = {}, devDependencies: Record<string, string> = {}) =>
  ({ name, version: '1.0.0', ...(Object.keys(dependencies).length ? { dependencies } : {}),
    ...(Object.keys(devDependencies).length ? { devDependencies } : {}) });
const remote = (version: string, dependencies: Record<string, string> = {}) =>
  ({ version, resolved: `https://registry.npmjs.org/x/-/${version}.tgz`, integrity: 'sha512-x', ...(Object.keys(dependencies).length ? { dependencies } : {}) });
export const MONO_LOCK = JSON.stringify({ lockfileVersion: 3, packages: {
  '': { name: 'radar', version: '1.0.0', workspaces: ['api', 'ui', 'packages/*'], devDependencies: { vitest: '^3.0.0' } },
  api: pkg('api-app', { express: '^4.0.0' }),
  ui: pkg('ui-app', { '@radar/domain': '*', '@radar/scoring': '*', lodash: '^4.0.0' }, { vite: '^6.0.0' }),
  'packages/domain': pkg('@radar/domain', { '@radar/sources': '*', zod: '^3.0.0' }),
  'packages/scoring': pkg('@radar/scoring', { lodash: '^4.0.0' }),
  'packages/sources': pkg('@radar/sources', { 'node-fetch': '^3.0.0' }),
  'node_modules/@radar/domain': { resolved: 'packages/domain', link: true },
  'node_modules/@radar/scoring': { resolved: 'packages/scoring', link: true },
  'node_modules/@radar/sources': { resolved: 'packages/sources', link: true },
  'node_modules/express': remote('4.0.0'),
  'node_modules/lodash': remote('4.0.0'),
  'node_modules/vite': remote('6.0.0'),
  'node_modules/vitest': remote('3.0.0'),
  'node_modules/zod': remote('3.0.0'),
  'node_modules/node-fetch': remote('3.0.0', { 'data-uri-to-buffer': '^4.0.0' }),
  'node_modules/data-uri-to-buffer': remote('4.0.0'),
} });
export const MONO_PATHS = ['package.json', 'api/package.json', 'ui/package.json', 'packages/domain/package.json',
  'packages/scoring/package.json', 'packages/sources/package.json'];

describe('workspace subset selection', () => {
  it('should accept safe workspace directories and refuse traversal or duplicates', () => {
    expect(parseInstallWorkspaces(['ui'])).toEqual(['ui']);
    expect(parseInstallWorkspaces(['ui', 'packages/domain'])).toEqual(['ui', 'packages/domain']);
    for (const value of [undefined]) expect(parseInstallWorkspaces(value)).toBeNull();
    for (const value of [[], [''], ['.'], ['..'], ['../x'], ['a/../b'], ['a//b'], ['/abs'], ['a/'], ['\\win'], ['ui', 'ui'], 'ui', [1]]) {
      expect(parseInstallWorkspaces(value)).toBeNull();
    }
    expect(isSafeWorkspaceName('packages/domain')).toBe(true);
    expect(isSafeWorkspaceName('')).toBe(false);
  });

  it('should match only declared workspaces of the root package.json', () => {
    expect(declaredWorkspaceDirs(MONO_ROOT, MONO_PATHS)).toEqual(new Set(['api', 'ui', 'packages/domain', 'packages/scoring', 'packages/sources']));
    expect(validateWorkspaces(['ui'], MONO_ROOT, MONO_PATHS)).toEqual(['ui']);
    expect(() => validateWorkspaces(['unknown'], MONO_ROOT, MONO_PATHS)).toThrowError(expect.objectContaining({ code: 'build_descriptor_invalid' }));
    expect(() => validateWorkspaces(['api/../ui'], MONO_ROOT, MONO_PATHS)).toThrowError(expect.objectContaining({ code: 'build_descriptor_invalid' }));
  });

  it('should keep the ui closure with transitive and linked workspaces while dropping api-only packages', () => {
    const keep = subsetLockPaths(MONO_LOCK, ['ui']);
    for (const path of ['node_modules/lodash', 'node_modules/vite', 'node_modules/zod',
      'node_modules/node-fetch', 'node_modules/data-uri-to-buffer']) {
      expect(keep.has(path)).toBe(true);
    }
    expect(keep.has('node_modules/express')).toBe(false);
    expect(keep.has('node_modules/vitest')).toBe(false);
  });

  it('should follow nested node_modules from the package itself, not its parent', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: {
      '': { name: 'root', workspaces: ['ui'] },
      ui: { name: 'ui', version: '1.0.0', dependencies: { a: '^1.0.0' } },
      'node_modules/a': { version: '1.0.0', dependencies: { b: '^1.0.0' } },
      'node_modules/b': { version: '1.0.0' },
      'node_modules/a/node_modules/b': { version: '1.0.1' },
    } });
    const keep = subsetLockPaths(lock, ['ui']);
    expect(keep.has('node_modules/a')).toBe(true);
    expect(keep.has('node_modules/a/node_modules/b')).toBe(true);
    expect(keep.has('node_modules/b')).toBe(false);
  });

  it('should keep workspace-local nested packages and refuse bad locks or unknown selections', () => {
    const lock = JSON.stringify({ lockfileVersion: 3, packages: {
      '': { name: 'root', workspaces: ['ui'] },
      ui: { name: 'ui', version: '1.0.0', dependencies: { x: '^1.0.0' } },
      'ui/node_modules/x': { version: '1.0.0' },
      'node_modules/x': { version: '9.9.9' },
    } });
    const keep = subsetLockPaths(lock, ['ui']);
    expect(keep.has('ui/node_modules/x')).toBe(true);
    expect(keep.has('node_modules/x')).toBe(false);
    expect(() => subsetLockPaths('not json', ['ui'])).toThrowError(expect.objectContaining({ code: 'dependency_cache_invalid' }));
    expect(() => subsetLockPaths(JSON.stringify({ lockfileVersion: 3, packages: {} }), ['ui']))
      .toThrowError(expect.objectContaining({ code: 'dependency_cache_invalid' }));
    expect(() => subsetLockPaths(MONO_LOCK, ['missing'])).toThrowError(expect.objectContaining({ code: 'build_descriptor_invalid' }));
  });

  it('should refuse unsupported workspace patterns fail-closed without rejecting a literal null segment', () => {
    expect(declaredWorkspaceDirs(JSON.stringify({ workspaces: ['**'] }), ['a/package.json'])).toEqual(new Set());
    expect(declaredWorkspaceDirs(JSON.stringify({ workspaces: ['pkg-*'] }), ['pkg-a/package.json'])).toEqual(new Set());
    expect(declaredWorkspaceDirs(JSON.stringify({ workspaces: ['!ui'] }), ['ui/package.json'])).toEqual(new Set());
    expect(declaredWorkspaceDirs(JSON.stringify({ workspaces: ['null'] }), ['null/package.json'])).toEqual(new Set(['null']));
  });
});
