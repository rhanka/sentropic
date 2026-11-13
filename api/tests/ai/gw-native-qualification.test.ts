import { afterAll, describe, it } from 'vitest';
import { qualificationSelected } from '../../src/services/llm-runtime/gw-native-qualification-cap';
import { QUALIFICATION_MODELS } from '../../src/services/llm-runtime/gw-native-qualification-plan';
import { qualificationFailure } from './gw-native-qualification-error';

const selected = qualificationSelected(process.env.SCOPE);
const targets = [...QUALIFICATION_MODELS.flatMap(model => ['sse', 'json', 'canonical', 'count'].map(name => ({ model, name }))),
  { model: QUALIFICATION_MODELS[0], name: 'websearch' }];

describe.sequential('isolated native qualification', () => {
  let run: Awaited<ReturnType<typeof import('./gw-native-qualification-run').createQualificationRun>> | undefined;
  let failed = false;
  it.skipIf(!selected)('should verify UAT readiness before arming any provider call', { retry: 0 }, async () => {
    // Import and readiness work occur inside the exact-SCOPE gate, never at module loading.
    try { run = await (await import('./gw-native-qualification-run')).createQualificationRun(); }
    catch (cause) { failed = true; throw qualificationFailure('Qualification readiness or sourced payload evidence failed', cause); }
  });
  for (const [index, target] of targets.entries()) {
    const acceptance = target.name === 'sse' ? 'clean_native_sse_is_measured_without_output_floor' : target.name;
    it.skipIf(!selected)(`${target.model} ${acceptance}`, { retry: 0 }, async context => {
      if (failed || !run || run.failed()) { context.skip(); return; }
      try { await run.runCase(index); }
      catch (cause) { failed = true; throw qualificationFailure('Qualification stopped at first failed case; no retry permitted', cause); }
    });
  }
  afterAll(async () => {
    if (!selected) return;
    try {
      if (run) await run.finish();
      else await (await import('./gw-native-qualification-run')).postQualificationReadinessFailure();
    } catch (cause) { throw qualificationFailure('Qualification post-run probes or identity checks failed', cause); }
  });
});
