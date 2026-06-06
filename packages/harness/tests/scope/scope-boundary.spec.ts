import { describe, expect, it } from 'vitest';
import { classifyPath, matchGlob, type ScopeBoundary } from '../../src/scope/scope-boundary.js';
import { sentropicProfile } from '../../src/profile/sentropic.js';
import { stubProfile } from '../../src/profile/stub.js';

const boundary: ScopeBoundary = {
  allowed: ['packages/harness/**', 'BRANCH.md'],
  forbidden: ['api/**', 'packages/**'],
  conditional: ['Makefile', '.github/workflows/ci.yml'],
};

describe('matchGlob', () => {
  it('** spans path segments', () => {
    expect(matchGlob('packages/harness/**', 'packages/harness/src/a/b.ts')).toBe(true);
    expect(matchGlob('packages/harness/**', 'packages/other/x.ts')).toBe(false);
  });
  it('* stays within a single segment', () => {
    expect(matchGlob('docker-compose*.yml', 'docker-compose.dev.yml')).toBe(true);
    expect(matchGlob('docker-compose*.yml', 'docker-compose/sub.yml')).toBe(false);
  });
});

describe('classifyPath (C2 precedence: allowed > forbidden > conditional > profile-default)', () => {
  it('explicit allowed wins over a broader explicit forbidden', () => {
    expect(classifyPath('packages/harness/src/index.ts', boundary, sentropicProfile)).toBe(
      'allowed',
    );
  });
  it('explicit forbidden when not allowed', () => {
    expect(classifyPath('api/src/app.ts', boundary, sentropicProfile)).toBe('forbidden');
  });
  it('explicit conditional overrides profile-default-forbidden (Makefile)', () => {
    expect(classifyPath('Makefile', boundary, sentropicProfile)).toBe('conditional');
  });
  it('profile default-forbidden when otherwise unlisted', () => {
    const empty: ScopeBoundary = { allowed: [], forbidden: [], conditional: [] };
    expect(classifyPath('Makefile', empty, sentropicProfile)).toBe('forbidden');
    expect(classifyPath('secret/key.txt', empty, stubProfile)).toBe('forbidden');
  });
  it('unknown when nothing matches', () => {
    const empty: ScopeBoundary = { allowed: [], forbidden: [], conditional: [] };
    expect(classifyPath('random/file.ts', empty, stubProfile)).toBe('unknown');
  });
});
