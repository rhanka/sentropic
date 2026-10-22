import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assertCT01, assertCT02, assertCT03 } from './objects-assertions.js';
import { OBJECT_MUTANTS } from './objects-mutants.js';
import { createObjectReference } from './objects-reference.js';

const cases = [assertCT01, assertCT02, assertCT03];
describe('L01b1 objects and manifests kit (reference only; no backend qualification)', () => {
  for (const [i, check] of cases.entries()) {
    it(`should pass CT-0${i + 1} on the independent positive reference`, async () => {
      await check(createObjectReference);
    });
    const mutant = OBJECT_MUTANTS[i];
    it(`should kill ${mutant.id}@${mutant.revision} at its ${mutant.target} assertion`, async () => {
      await check(createObjectReference); // Positive pass is mandatory before accepting this kill.
      await assert.rejects(check(mutant.factory), mutant.kill);
    });
  }
  it('should fail closed when the requested fixture environment is missing', async () => {
    for (const check of cases) await assert.rejects(check(() => undefined as never), /missing CT-0[123] fixture/);
  });
  it('should fail closed when required instrumentation is missing', async () => {
    for (const check of cases) await assert.rejects(check(() => {
      const f = createObjectReference();
      f.counters.io = undefined as never;
      return f;
    }), /missing CT-0[123] instrumentation/);
  });
});
