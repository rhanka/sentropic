import { describe, expect, it } from 'vitest';
import { runHarnessCli } from '../../src/cli/run.js';
import { harnessCliCommandIntentAdapter } from '../../src/cli/command-intent.js';

function capture(argv: string[]): { code: number; text: string } {
  const lines: string[] = [];
  const code = runHarnessCli(argv, (s) => lines.push(s));
  return { code, text: lines.join('\n') };
}

function json(argv: string[]): { code: number; obj: Record<string, unknown> } {
  const { code, text } = capture(argv);
  return { code, obj: JSON.parse(text) as Record<string, unknown> };
}

describe('harness verify (VerificationRun roll-up)', () => {
  it('projects verification intent without running a check', () => {
    expect(harnessCliCommandIntentAdapter.parseIntent(['verify', '--category', 'ci'])).toEqual({
      runnerId: 'harness', source: '@sentropic/harness', argv: ['verify', '--category', 'ci'],
    });
  });

  it('tags the run with the requested category', () => {
    const { code, obj } = json(['verify', '--category', 'ci', '--json']);
    expect(code).toBe(0);
    expect(obj.schemaVersion).toBe(1);
    expect(obj.category).toBe('ci');
    expect(obj.command).toBe('harness verify');
  });

  it('aggregates C2 scope + C1 branch into one run', () => {
    const { obj } = json([
      'verify', '--category', 'static',
      '--staged-files', 'Makefile',
      '--current-branch', 'main', '--expected-branch', 'feat/x',
      '--json',
    ]);
    const checks = obj.checks as { code: string }[];
    expect(checks.map((c) => c.code).sort()).toEqual(['C1', 'C2']);
    expect(obj.result).toBe('fail');
  });

  it('rejects an unknown category (exit 2)', () => {
    expect(capture(['verify', '--category', 'bogus']).code).toBe(2);
  });

  it('clean error (exit 2) when the plan file is unreadable', () => {
    const { code, text } = capture(['verify', '--branch-md', '/nope/BRANCH.md', '--staged-files', 'x.ts']);
    expect(code).toBe(2);
    expect(text).toMatch(/cannot read plan file/);
  });

  it('verify with no inputs is a vacuous pass (0 checks)', () => {
    const { obj } = json(['verify', '--json']);
    expect(obj.result).toBe('pass');
    expect((obj.checks as unknown[]).length).toBe(0);
  });
});

describe('harness init (profile scaffold)', () => {
  it('emits the sentropic profile descriptor', () => {
    const { code, obj } = json(['init', '--json']);
    expect(code).toBe(0);
    expect(obj.id).toBe('sentropic');
    expect(obj.forbiddenPathDefaults).toContain('Makefile');
    expect(typeof obj.exceptionIdPattern).toBe('string');
    expect(obj.branchMatch).toBe('exact');
  });

  it('emits a divergent stub profile (genericity)', () => {
    const { obj } = json(['init', '--profile', 'stub', '--json']);
    expect(obj.id).toBe('stub');
  });

  it('human output names the profile', () => {
    expect(capture(['init']).text).toMatch(/harness init — profile 'sentropic'/);
  });
});

describe('harness audit (repo-vs-profile drift)', () => {
  it('flags a profile-forbidden path as drift', () => {
    const { code, obj } = json(['audit', '--staged-files', 'Makefile', '--json']);
    expect(code).toBe(0);
    expect(obj.command).toBe('harness audit');
    expect(obj.category).toBe('static');
    expect(obj.result).toBe('fail');
    expect((obj.violations as unknown[]).length).toBeGreaterThan(0);
  });

  it('passes when there is nothing to audit (no changed files)', () => {
    const { obj } = json(['audit', '--json']);
    expect(obj.result).toBe('pass');
  });

  it('flags an undeclared path as drift when no BRANCH.md scope is declared', () => {
    const { obj } = json(['audit', '--staged-files', 'packages/harness/src/x.ts', '--json']);
    expect(obj.result).toBe('fail');
    expect((obj.violations as { message: string }[])[0].message).toMatch(/unknown/);
  });
});
