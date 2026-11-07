import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkScope } from '../../src/checks/scope-check.js';
import { checkBranch } from '../../src/checks/branch-check.js';
import { parseBranchMd } from '../../src/branch-md/parse.js';
import { sentropicProfile } from '../../src/profile/sentropic.js';
import { stubProfile } from '../../src/profile/stub.js';
import { parseHarnessProfile, toProfileDocument, ProfileValidationError } from '../../src/profile/document.js';

const base = {
  id: 'custom', forbiddenPathDefaults: ['LICENSE'], exceptionIdPattern: '^EXC-\\d+$',
  conditionalRequiresException: true, branchMatch: 'exact',
};

describe('strict profile document validation', () => {
  it.each([
    [null, 'INVALID_PROFILE'],
    [[], 'INVALID_PROFILE'],
    [{ ...base, typo: true }, 'UNKNOWN_KEY'],
    [{ ...base, branchMd: { file: 'BRANCH.md', typo: true } }, 'UNKNOWN_KEY'],
    [{ ...base, commitMessage: { forbiddenPatterns: [], typo: true } }, 'UNKNOWN_KEY'],
    [{ ...base, id: '' }, 'INVALID_PROFILE'],
    [{ ...base, forbiddenPathDefaults: [''] }, 'INVALID_PROFILE'],
    [{ ...base, forbiddenPathDefaults: [1] }, 'INVALID_PROFILE'],
    [{ ...base, allowedPathDefaults: ['/absolute/**'] }, 'INVALID_PROFILE'],
    [{ ...base, conditionalPathDefaults: ['../outside/**'] }, 'INVALID_PROFILE'],
    [{ ...base, forbiddenPathDefaults: ['src\\windows'] }, 'INVALID_PROFILE'],
    [{ ...base, conditionalRequiresException: 'yes' }, 'INVALID_PROFILE'],
    [{ ...base, branchMatch: 'similar' }, 'INVALID_PROFILE'],
    [{ ...base, exceptionIdPattern: '[' }, 'INVALID_REGEX'],
    [{ ...base, commitMessage: { forbiddenPatterns: ['['] } }, 'INVALID_REGEX'],
    [{ ...base, commitMessage: { requiredPattern: '[', forbiddenPatterns: [] } }, 'INVALID_REGEX'],
    [{ ...base, branchMd: { file: '../BRANCH.md' } }, 'INVALID_PROFILE'],
    [{ ...base, forbiddenPathDefaults: undefined }, 'INVALID_PROFILE'],
  ])('rejects invalid configuration %# with a typed error', (input, code) => {
    try { parseHarnessProfile(input); expect.fail('configuration must be rejected'); }
    catch (error) {
      expect(error).toBeInstanceOf(ProfileValidationError);
      expect(error).toMatchObject({ code });
    }
  });

  it('keeps the README Rust + Node example executable under the published contract', () => {
    const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
    const example = /```json\n([\s\S]*?)\n```/.exec(readme)![1];
    const profile = parseHarnessProfile(JSON.parse(example));
    for (const path of ['Cargo.toml', '.githooks/pre-commit', 'LICENSE']) {
      expect(checkScope({ stagedFiles: [path], profile,
        boundary: { allowed: [], forbidden: [], conditional: [] } }).violations[0].message)
        .toBe(`forbidden path touched: ${path}`);
    }
  });

  it('reports the full path to an unknown nested key', () => {
    expect(() => parseHarnessProfile({ ...base, commitMessage: { typo: [] } }))
      .toThrow(/commitMessage.typo/);
  });

  it('reads custom BRANCH headings and exception grammar', () => {
    const profile = parseHarnessProfile({ ...base, branchMd: {
      file: 'PLAN.md', allowedHeading: 'Granted', forbiddenHeading: 'Denied',
      conditionalHeading: 'Reviewed', planHeading: 'Tasks',
    } });
    const parsed = parseBranchMd('# Feature: x\n- **Granted**: `src/**`\n- **Denied**: `private/**`\n' +
      '- **Reviewed**: `Cargo.lock`\n## Feedback Loop\n- EXC-1\n## Tasks\n- [x] **Lot 1**\n', profile);
    expect(parsed.allowedPaths).toEqual(['src/**']);
    expect(parsed.forbiddenPaths).toEqual(['private/**']);
    expect(parsed.conditionalPaths).toEqual(['Cargo.lock']);
    expect(parsed.exceptions).toEqual(['EXC-1']);
    expect(parsed.lots[0].checked).toBe(true);
  });

  it('keeps branch scope overrides ahead of profile defaults', () => {
    const profile = parseHarnessProfile({ ...base,
      allowedPathDefaults: ['src/**'], conditionalPathDefaults: ['Cargo.lock'],
    });
    expect(checkScope({ stagedFiles: ['LICENSE'], profile,
      boundary: { allowed: ['LICENSE'], forbidden: [], conditional: [] } }).pass).toBe(true);
    expect(checkScope({ stagedFiles: ['src/lib.rs'], profile,
      boundary: { allowed: [], forbidden: ['src/**'], conditional: [] } }).pass).toBe(false);
  });
});

describe.each([
  [sentropicProfile, ['Makefile', 'docker-compose.test.yml', '.cursor/rules/a.md'], 'BR42h-EX1', false],
  [stubProfile, ['secret/key'], 'EXC-1', true],
] as const)('built-in %s JSON round-trip regression', (builtin, forbidden, exception, conditionalPass) => {
  const loaded = () => parseHarnessProfile(JSON.parse(JSON.stringify(toProfileDocument(builtin))));
  const boundary = { allowed: ['src/**'], forbidden: ['private/**'], conditional: ['config/**'] };

  it('preserves every C2 result across representative input and exception matrices', () => {
    for (const path of [...forbidden, 'src/x.ts', 'private/key', 'config/file', 'unknown']) {
      for (const declaredExceptions of [[], [exception], ['invalid']]) {
        const input = { stagedFiles: [path], boundary, declaredExceptions };
        expect(checkScope({ ...input, profile: loaded() })).toEqual(checkScope({ ...input, profile: builtin }));
      }
    }
    expect(checkScope({ stagedFiles: ['config/file'], boundary, profile: loaded() }).pass).toBe(conditionalPass);
    for (const path of forbidden) {
      expect(checkScope({ stagedFiles: [path], boundary, profile: loaded() }).violations[0].message)
        .toBe(`forbidden path touched: ${path}`);
    }
  });

  it('preserves C1 exact/prefix behavior and unchanged BRANCH parsing', () => {
    for (const currentBranch of ['feat/x', 'feat/x-sub', 'main', '']) {
      const input = { currentBranch, expectedBranch: 'feat/x' };
      expect(checkBranch({ ...input, profile: loaded() })).toEqual(checkBranch({ ...input, profile: builtin }));
    }
    expect(toProfileDocument(loaded())).toEqual(toProfileDocument(builtin));
  });
});
