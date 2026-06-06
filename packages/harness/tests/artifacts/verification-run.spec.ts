import { describe, expect, it } from 'vitest';
import { toVerificationRun } from '../../src/run/emit.js';
import type { VerificationRun } from '../../src/artifacts/verification-run.js';

describe('VerificationRun golden shape', () => {
  it('has all v0 fields and is a superset of track TestRun{commit,env,runner,result,at}', () => {
    const run = toVerificationRun(
      [{ code: 'C2', category: 'static', result: { pass: true, violations: [] } }],
      {
        runId: 'run-1',
        commit: 'deadbeef',
        branch: 'feat/harness-core',
        env: 'test-feat-harness-core',
        runner: 'harness',
        category: 'static',
        command: 'harness check scope',
        startedAt: '2026-06-04T09:00:00.000Z',
        finishedAt: '2026-06-04T09:00:00.500Z',
      },
    );

    const expected: VerificationRun = {
      schemaVersion: 1,
      runId: 'run-1',
      commit: 'deadbeef',
      branch: 'feat/harness-core',
      env: 'test-feat-harness-core',
      runner: 'harness',
      category: 'static',
      command: 'harness check scope',
      result: 'pass',
      startedAt: '2026-06-04T09:00:00.000Z',
      finishedAt: '2026-06-04T09:00:00.500Z',
      checks: [{ code: 'C2', category: 'static', pass: true, violations: [] }],
      violations: [],
      artifacts: [],
    };
    expect(run).toEqual(expected);

    // The fields a track-side adapter needs to derive a TestRun must all be present.
    expect({
      commit: run.commit,
      env: run.env,
      runner: run.runner,
      result: run.result,
      at: run.finishedAt,
    }).toEqual({
      commit: 'deadbeef',
      env: 'test-feat-harness-core',
      runner: 'harness',
      result: 'pass',
      at: '2026-06-04T09:00:00.500Z',
    });
  });
});
