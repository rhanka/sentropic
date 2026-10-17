import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NANO_CANDIDATES } from '../utils/nano-qualification-budget';
import { NANO_PRODUCTION_CHUNK_CASES } from './nano-replacement-fixtures';

const selected = process.env.SCOPE?.trim() === 'tests/ai/nano-replacement-production-chunks.test.ts'
  && existsSync(resolve(process.cwd(), '../.tmp/nano-retirement/production-chunks/source-commit'));
describe.sequential('paired production-threshold chunk supplement', () => {
  let run: ReturnType<typeof import('./nano-replacement-production-run').createNanoProductionRun> | undefined;
  it.skipIf(!selected)('should verify prior spend before reserving the remaining cumulative allowance', { retry: 0 }, async () => {
    run = (await import('./nano-replacement-production-run')).createNanoProductionRun();
  });
  for (const model of NANO_CANDIDATES) {
    for (const fixture of NANO_PRODUCTION_CHUNK_CASES) {
      it.skipIf(!selected)(`${model} ${fixture.id}`, { retry: 0 }, async (context) => {
        if (!run || run.failed()) { context.skip(); return; }
        const result = await run.runCase(fixture, model);
        expect(result.valid, JSON.stringify(result.checks)).toBe(true);
      });
    }
  }
  afterEach(() => run?.abortActive());
  afterAll(() => run?.finish());
});
