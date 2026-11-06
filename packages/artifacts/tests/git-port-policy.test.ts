import { describe, expect, it } from 'vitest';
import { gitPath, matchesGitGlob } from '../src/server/git-port-policy.js';
import type { GitPortRepository, GitPortTarget } from '../src/server/git-port.js';

const target: GitPortTarget = { storageScopeId: 'scope', repoId: 'repo', branch: 'artifact/p/human/app', subPath: '', outputDir: 'dist' };
const repo: GitPortRepository = { ...target, locator: 'owner/repo', installationRef: 'enrolled', branchPrefix: 'artifact/',
  canWrite: true, allowedSubPaths: [''], writablePaths: ['ui/**', 'packages/*/src/**'],
  refusedWritePaths: ['.github/**', 'deploy/**', 'api/**', '.track/**', 'package*.json'] };

describe('GitPort path admission', () => {
  it.each(['../ui/a.ts', 'ui/../a.ts', '/ui/a', 'ui//a', './ui/a', 'ui/./a', 'ui\\a',
    'ui/%2e%2e/a', 'ui/a\0', '.git/config', '.env', 'ui/.env.local', 'ui/server.key',
    'ui/private.pem', 'ui/id_ed25519', '.github/workflows/a.yml'])('should refuse unsafe reads before transport: %s', (path) => {
    expect(() => gitPath(repo, target, path, false)).toThrowError('git_path_refused');
  });
  it.each(['ui/a.ts', 'packages/widgets/src/a.ts', 'ui/sub/app.ts'])('should admit A1 source writes: %s', path => {
    expect(gitPath(repo, target, path, true)).toBe(path);
  });
  it.each(['api/a.ts', 'deploy/a', '.track/events', 'package.json', 'package-lock.json',
    'ui/package.json', 'ui/sub/package-lock.json', 'ui/dist/a.js', 'dist/a.js', 'README.md',
    'packages/widgets/test/a.ts'])('should refuse A1 writes outside policy: %s', path => {
    expect(() => gitPath(repo, target, path, true)).toThrowError('git_path_refused');
  });
  it('should allow root manifests for reads and apply globs after subPath resolution', () => {
    expect(gitPath(repo, target, 'package.json', false)).toBe('package.json');
    expect(gitPath({ ...repo, allowedSubPaths: ['ui'] }, { ...target, subPath: 'ui' }, 'a.ts', true)).toBe('ui/a.ts');
    expect(() => gitPath({ ...repo, allowedSubPaths: ['ui'] }, { ...target, subPath: 'ui' }, 'package.json', true)).toThrow();
  });
  it('should give denials precedence and default to no writable paths', () => {
    expect(() => gitPath({ ...repo, refusedWritePaths: ['ui/**'] }, target, 'ui/a.ts', true)).toThrow();
    expect(() => gitPath({ ...repo, writablePaths: [] }, target, 'ui/a.ts', true)).toThrow();
    expect(matchesGitGlob('packages/a/src/x/y.ts', 'packages/*/src/**')).toBe(true);
    expect(matchesGitGlob('packages/a/b/src/x.ts', 'packages/*/src/**')).toBe(false);
  });
});
