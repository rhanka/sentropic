import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createExecutionContext, executeProof } from '../execution.mjs';
import { writeImmutable } from '../candidate.mjs';
import { sha256 } from '../precandidate.mjs';

it('binds a fresh process report without relabeling assertions and refuses stale output or a changed manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'l5-execution-'));
  try {
    const manifestPath = 'manifest.json', sourceHead = 'a'.repeat(40);
    writeImmutable(root, manifestPath, { stage: 'candidate', source: { l5Head: sourceHead } });
    const binding = createExecutionContext(root, manifestPath, sourceHead);
    const fixture = join(root, 'vitest-fixture.cjs');
    writeFileSync(fixture, `const fs=require('node:fs'); const output=process.argv.find(a=>a.startsWith('--outputFile=')).split('=')[1]; fs.writeFileSync(output, JSON.stringify({success:true,testResults:[{name:'test.ts',assertionResults:[{fullName:'actual assertion',status:'passed'}]}]})); process.exit(Number(process.env.L5_FIXTURE_EXIT||0));`);
    const call = output => executeProof({ root, output, executable: process.execPath,
      args: [fixture], cwd: root, executionMode: 'source-only' });
    expect(call('result.json').status).toBe(0);
    const report = JSON.parse(readFileSync(join(root, 'result.json')));
    expect(report).toMatchObject({ ...binding, success: true, executionMode: 'source-only' });
    expect(report.testResults[0].assertionResults[0].fullName).toBe('actual assertion');
    expect(sha256(readFileSync(join(root, report.rawReport.path)))).toBe(report.rawReport.sha256);
    expect(() => call('result.json')).toThrow(/existing report/);
    process.env.L5_FIXTURE_EXIT = '7';
    expect(call('failed.json').status).toBe(7);
    expect(JSON.parse(readFileSync(join(root, 'failed.json'))).success).toBe(false);
    delete process.env.L5_FIXTURE_EXIT;
    writeFileSync(join(root, manifestPath), '{}');
    expect(() => call('changed.json')).toThrow(/manifest changed/);
  } finally { delete process.env.L5_FIXTURE_EXIT; rmSync(root, { recursive: true, force: true }); }
});
