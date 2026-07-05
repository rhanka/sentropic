import { describe, expect, it } from 'vitest';
import { runHarnessCli } from '../../src/cli/run.js';

function capture(argv: string[]): { code: number; text: string } {
  const lines: string[] = [];
  const code = runHarnessCli(argv, (s) => lines.push(s));
  return { code, text: lines.join('\n') };
}

describe('harness CLI (pure, arg-based)', () => {
  it('prints usage and returns 0 with no args', () => {
    const { code, text } = capture([]);
    expect(code).toBe(0);
    expect(text).toMatch(/usage: harness check/);
  });

  it('returns 2 on an unknown command', () => {
    expect(capture(['bogus']).code).toBe(2);
  });

  it('check branch — reports C1 FAIL on mismatch (advisory: exit 0)', () => {
    const { code, text } = capture([
      'check', 'branch', '--current-branch', 'main', '--expected-branch', 'feat/harness-core',
    ]);
    expect(code).toBe(0);
    expect(text).toMatch(/FAIL C1/);
  });

  it('check scope — reports C2 FAIL for a profile-forbidden path', () => {
    const { code, text } = capture(['check', 'scope', '--staged-files', 'Makefile', '--profile', 'sentropic']);
    expect(code).toBe(0);
    expect(text).toMatch(/FAIL C2/);
    expect(text).toMatch(/forbidden/);
  });

  it('check scope --json emits a VerificationRun', () => {
    const { text } = capture(['check', 'scope', '--staged-files', 'Makefile', '--json']);
    const obj = JSON.parse(text) as { schemaVersion: number; result: string; checks: { code: string }[] };
    expect(obj.schemaVersion).toBe(1);
    expect(obj.result).toBe('fail');
    expect(obj.checks[0].code).toBe('C2');
  });

  it('check scope — clean error (exit 2, no throw) when the plan file is unreadable', () => {
    const { code, text } = capture([
      'check', 'scope', '--branch-md', '/nonexistent/BRANCH.md', '--staged-files', 'x.ts',
    ]);
    expect(code).toBe(2);
    expect(text).toMatch(/cannot read plan file: \/nonexistent\/BRANCH\.md/);
  });
});
