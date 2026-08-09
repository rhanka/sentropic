import { describe, expect, it } from 'vitest';
import { modelProfiles } from '../src/catalog.js';
import {
  DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
  EquivalenceCouncilError,
  validateEquivalenceCouncil,
} from '../src/equivalence-council.js';

describe('model equivalence council', () => {
  const now = new Date('2026-08-08T12:00:00Z');

  it('classifies every catalog model exactly once', () => {
    expect(() => validateEquivalenceCouncil(
      DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      modelProfiles,
      now,
    )).not.toThrow();
  });

  it('fails when a newly added catalog model is not reviewed', () => {
    const profiles = [...modelProfiles, {
      ...modelProfiles[0],
      modelId: 'unreviewed-model' as never,
    }];

    expect(() => validateEquivalenceCouncil(
      DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      profiles,
      now,
    )).toThrow(/model must be classified exactly once: openai:unreviewed-model/);
  });

  it('fails closed when an exclusion expires', () => {
    const council = {
      ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      exclusions: DEFAULT_MODEL_EQUIVALENCE_COUNCIL.exclusions.map((entry, index) =>
        index === 0 ? { ...entry, expiresAt: '2026-08-01T00:00:00Z' } : entry),
    };

    expect(() => validateEquivalenceCouncil(council, modelProfiles, now))
      .toThrow(EquivalenceCouncilError);
  });
});
