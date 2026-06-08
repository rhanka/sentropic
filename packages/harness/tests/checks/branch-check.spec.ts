import { describe, expect, it } from 'vitest';
import { checkBranch } from '../../src/checks/branch-check.js';
import { toVerificationRun } from '../../src/run/emit.js';
import { sentropicProfile } from '../../src/profile/sentropic.js';
import { stubProfile } from '../../src/profile/stub.js';

describe('checkBranch (C1)', () => {
  it('passes on exact match', () => {
    const r = checkBranch({
      currentBranch: 'feat/harness-core',
      expectedBranch: 'feat/harness-core',
      profile: sentropicProfile,
    });
    expect(r.pass).toBe(true);
  });

  it('fails on mismatch', () => {
    const r = checkBranch({
      currentBranch: 'main',
      expectedBranch: 'feat/harness-core',
      profile: sentropicProfile,
    });
    expect(r.pass).toBe(false);
    expect(r.violations[0].code).toBe('C1');
  });

  it('passes via a documented bypass', () => {
    const r = checkBranch({
      currentBranch: 'main',
      expectedBranch: 'feat/x',
      profile: sentropicProfile,
      bypass: { reason: 'detached UAT worktree' },
    });
    expect(r.pass).toBe(true);
    expect(r.bypass?.reason).toBe('detached UAT worktree');
  });

  it('uses prefix match under a profile with branchMatch=prefix (stub)', () => {
    const r = checkBranch({
      currentBranch: 'feat/harness-core-sub',
      expectedBranch: 'feat/harness-core',
      profile: stubProfile,
    });
    expect(r.pass).toBe(true);
  });
});

describe('toVerificationRun', () => {
  it('assembles a neutral run: result=fail when any check fails, flattens violations', () => {
    const branch = checkBranch({
      currentBranch: 'main',
      expectedBranch: 'feat/harness-core',
      profile: sentropicProfile,
    });
    const run = toVerificationRun(
      [{ code: 'C1', category: 'static', result: branch }],
      {
        runId: 'r1',
        commit: 'abc123',
        branch: 'main',
        env: 'test-feat-harness-core',
        runner: 'harness',
        category: 'static',
        command: 'harness check branch',
        startedAt: '2026-06-04T00:00:00.000Z',
        finishedAt: '2026-06-04T00:00:01.000Z',
      },
    );
    expect(run.schemaVersion).toBe(1);
    expect(run.result).toBe('fail');
    expect(run.checks).toHaveLength(1);
    expect(run.violations).toHaveLength(1);
    expect(run.violations[0].code).toBe('C1');
    // superset of track TestRun{commit,env,runner,result,at}
    expect(run.commit).toBe('abc123');
    expect(run.env).toBe('test-feat-harness-core');
    expect(run.runner).toBe('harness');
  });
});
