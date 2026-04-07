import { describe, expect, it } from 'vitest';
import { normalizeExecutiveSummaryPayload } from '../../src/services/executive-summary';

describe('normalizeExecutiveSummaryPayload', () => {
  it('preserves executive summary references when present', () => {
    const result = normalizeExecutiveSummaryPayload({
      introduction: 'Intro',
      analyse: 'Analyse',
      recommandation: 'Reco',
      synthese_executive: 'Synthese',
      references: [
        {
          title: 'Source 1',
          url: 'https://example.com/1',
          excerpt: 'Extrait 1',
        },
        {
          title: 'Source 2',
          url: 'https://example.com/2',
        },
      ],
    });

    expect(result.references).toEqual([
      {
        title: 'Source 1',
        url: 'https://example.com/1',
        excerpt: 'Extrait 1',
      },
      {
        title: 'Source 2',
        url: 'https://example.com/2',
        excerpt: undefined,
      },
    ]);
  });

  it('drops malformed references and falls back to an empty array', () => {
    const result = normalizeExecutiveSummaryPayload({
      intro: 'Intro',
      analysis: 'Analyse',
      recommendation: 'Reco',
      summary: 'Synthese',
      references: [
        { title: 'Missing URL' },
        { url: 'https://example.com/no-title' },
        'not-an-object',
      ],
    });

    expect(result.introduction).toBe('Intro');
    expect(result.analyse).toBe('Analyse');
    expect(result.recommandation).toBe('Reco');
    expect(result.synthese_executive).toBe('Synthese');
    expect(result.references).toEqual([]);
  });
});
