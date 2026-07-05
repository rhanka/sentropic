import { describe, expect, it } from 'vitest';
import { checkScope } from '../../src/checks/scope-check.js';
import { checkBranch } from '../../src/checks/branch-check.js';
import { classifyPath, type ScopeBoundary } from '../../src/scope/scope-boundary.js';
import { sentropicProfile } from '../../src/profile/sentropic.js';
import { stubProfile } from '../../src/profile/stub.js';

// Genericity proof: the SAME inputs run under two profiles must produce DIVERGENT outcomes,
// proving the engine reads the profile (policy-as-data) rather than hardcoding `sentropic`.
// "Both pass" would be theatre — every assertion below asserts a divergence on identical input.

describe('profile genericity (engine reads the profile, not hardcoded sentropic)', () => {
  it('conditionalRequiresException diverges: Conditional w/o exception FAILS under sentropic, PASSES under stub', () => {
    const boundary: ScopeBoundary = { allowed: [], forbidden: [], conditional: ['Makefile'] };
    const base = { stagedFiles: ['Makefile'], boundary, declaredExceptions: [] as string[] };
    const sent = checkScope({ ...base, profile: sentropicProfile });
    const stub = checkScope({ ...base, profile: stubProfile });
    expect(sent.pass).toBe(false);
    expect(stub.pass).toBe(true);
    expect(sent.pass).not.toBe(stub.pass);
  });

  it('forbiddenPathDefaults diverges: the same path classifies differently per profile', () => {
    const empty: ScopeBoundary = { allowed: [], forbidden: [], conditional: [] };
    // 'Makefile' is a sentropic default-forbidden but not a stub one.
    expect(classifyPath('Makefile', empty, sentropicProfile)).toBe('forbidden');
    expect(classifyPath('Makefile', empty, stubProfile)).toBe('unknown');
    // 'secret/x' is a stub default-forbidden but not a sentropic one.
    expect(classifyPath('secret/key.txt', empty, sentropicProfile)).toBe('unknown');
    expect(classifyPath('secret/key.txt', empty, stubProfile)).toBe('forbidden');
  });

  it('branchMatch diverges: a sub-branch FAILS exact (sentropic) but PASSES prefix (stub)', () => {
    const base = { currentBranch: 'feat/x-sub', expectedBranch: 'feat/x' };
    const sent = checkBranch({ ...base, profile: sentropicProfile });
    const stub = checkBranch({ ...base, profile: stubProfile });
    expect(sent.pass).toBe(false);
    expect(stub.pass).toBe(true);
  });
});
