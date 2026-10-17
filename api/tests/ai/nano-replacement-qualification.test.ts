import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { NANO_CANDIDATES, qualificationSelected } from '../utils/nano-qualification-budget';
import { NANO_CASES } from './nano-replacement-fixtures';

// Exact SCOPE plus an ignored, SHA-pinned arming file: CI sharding cannot accidentally admit egress.
const selected = qualificationSelected(process.env.SCOPE) && existsSync(resolve(process.cwd(), '../.tmp/nano-retirement/source-commit'));

describe.sequential('paired nano retirement qualification', () => {
  let run: ReturnType<typeof import('./nano-replacement-run').createNanoQualificationRun> | undefined;
  let readinessFailed = false;
  it.skipIf(!selected)('should pin source and arm one durable shared budget before any provider request', { retry: 0 }, async () => {
    try { run = (await import('./nano-replacement-run')).createNanoQualificationRun(); }
    catch { readinessFailed = true; throw new Error('Qualification readiness failed; no new campaign or budget may replace an existing journal'); }
  });
  for (const model of NANO_CANDIDATES) {
    for (const fixture of NANO_CASES) {
      it.skipIf(!selected)(`${model} ${fixture.id}`, { retry: 0 }, async (context) => {
        if (readinessFailed || !run || run.failed()) { context.skip(); return; }
        const result = await run.runCase(fixture, model);
        expect(result.valid, JSON.stringify(result.checks)).toBe(true);
      });
    }
  }
  afterEach(() => run?.abortActive());
  afterAll(() => { if (run) run.finish(); });
});
