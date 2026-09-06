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

  it('classifies Gemini 3.8 Flash, Fable 5.1, and GPT-6 Astra explicitly', () => {
    const excluded = DEFAULT_MODEL_EQUIVALENCE_COUNCIL.exclusions.map(
      ({ providerId, modelId }) => `${providerId}:${modelId}`,
    );

    expect(excluded).toContain('anthropic:claude-fable-5-1');
    expect(excluded).toContain('gemini:gemini-3.8-flash');
    expect(excluded).toContain('openai:gpt-6-astra');
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

  it('fails closed when the council publication itself expires', () => {
    expect(() => validateEquivalenceCouncil({
      ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      expiresAt: '2026-08-01T00:00:00Z',
    }, modelProfiles, now)).toThrow(/expired council/);
  });

  it('rejects member capabilities explicitly marked unsupported', () => {
    const council = {
      ...DEFAULT_MODEL_EQUIVALENCE_COUNCIL,
      exclusions: DEFAULT_MODEL_EQUIVALENCE_COUNCIL.exclusions.filter(
        (entry) => entry.modelId !== 'gpt-4.1-nano',
      ),
      groups: [{
        id: 'reasoning-fixture', intent: 'reasoning' as const,
        expiresAt: '2027-01-01T00:00:00Z',
        evidence: [{
          suite: 'fixture', artifact: 'fixture.json', measuredAt: '2026-08-01T00:00:00Z',
          dimensions: { quality: 'equivalent' },
        }],
        members: [{
          providerId: 'openai', modelId: 'gpt-4.1-nano', rank: 1,
          requiredCapabilities: ['reasoning' as const],
        }],
      }],
    };

    expect(() => validateEquivalenceCouncil(council, modelProfiles, now))
      .toThrow(/missing capability reasoning: openai:gpt-4.1-nano/);
  });
});
