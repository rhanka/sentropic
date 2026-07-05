import { describe, expect, it } from 'vitest';
import { checkScope } from '../../src/checks/scope-check.js';
import type { ScopeBoundary } from '../../src/scope/scope-boundary.js';
import { sentropicProfile } from '../../src/profile/sentropic.js';

const boundary: ScopeBoundary = {
  allowed: ['packages/harness/**', 'BRANCH.md'],
  forbidden: ['api/**', 'packages/**'],
  conditional: ['Makefile'],
};

describe('checkScope (C2 matrix)', () => {
  it('passes for in-scope files', () => {
    const r = checkScope({
      stagedFiles: ['packages/harness/src/index.ts', 'BRANCH.md'],
      boundary,
      profile: sentropicProfile,
    });
    expect(r.pass).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags a forbidden path', () => {
    const r = checkScope({ stagedFiles: ['api/src/app.ts'], boundary, profile: sentropicProfile });
    expect(r.pass).toBe(false);
    expect(r.violations[0].code).toBe('C2');
    expect(r.violations[0].path).toBe('api/src/app.ts');
  });

  it('honors allowed-beats-forbidden precedence', () => {
    const r = checkScope({
      stagedFiles: ['packages/harness/src/a.ts'],
      boundary,
      profile: sentropicProfile,
    });
    expect(r.pass).toBe(true);
  });

  it('flags a conditional path WITHOUT a matching exception', () => {
    const r = checkScope({
      stagedFiles: ['Makefile'],
      boundary,
      profile: sentropicProfile,
      declaredExceptions: [],
    });
    expect(r.pass).toBe(false);
    expect(r.violations[0].message).toMatch(/conditional/);
  });

  it('accepts a conditional path WITH a grammar-matching exception', () => {
    const r = checkScope({
      stagedFiles: ['Makefile'],
      boundary,
      profile: sentropicProfile,
      declaredExceptions: ['BR42h-EX1'],
    });
    expect(r.pass).toBe(true);
  });

  it('rejects a conditional path when the exception id violates the profile grammar', () => {
    const r = checkScope({
      stagedFiles: ['Makefile'],
      boundary,
      profile: sentropicProfile,
      declaredExceptions: ['EXC-1'], // not BRxx-EXn
    });
    expect(r.pass).toBe(false);
  });

  it('flags an unknown path', () => {
    const r = checkScope({ stagedFiles: ['random/file.ts'], boundary, profile: sentropicProfile });
    expect(r.pass).toBe(false);
    expect(r.violations[0].message).toMatch(/unknown/);
  });
});
