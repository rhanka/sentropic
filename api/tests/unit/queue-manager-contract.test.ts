import { describe, expect, it } from 'vitest';
import {
  buildGeneratedUseCasePayloadForPersistence,
  normalizeAutoGenerationSectionKeys,
} from '../../src/services/queue-manager';
import type { UseCaseDetail } from '../../src/services/context-usecase';

describe('queue manager contracts', () => {
  it('normalizes auto-comment section keys for each context', () => {
    expect(
      normalizeAutoGenerationSectionKeys('usecase', [
        'data.name',
        'data.domain',
        'data.constraints',
        'data.domain',
        '',
      ])
    ).toEqual(['name', 'domain', 'constraints']);

    expect(normalizeAutoGenerationSectionKeys('organization', ['name', 'industry', 'industry'])).toEqual([
      'name',
      'industry',
    ]);

    expect(
      normalizeAutoGenerationSectionKeys('executive_summary', [
        'introduction',
        'analyse',
        'synthese_executive',
      ])
    ).toEqual(['introduction', 'analyse', 'synthese_executive']);
  });

  it('builds generated usecase payload without persisting unsupported process/prerequisites fields', () => {
    const detail: UseCaseDetail = {
      name: 'Generated use case',
      description: 'Generated description',
      problem: 'Current workflow is slow',
      solution: 'Automate qualification and routing',
      domain: 'Operations',
      technologies: ['OCR', 'NLP'],
      leadtime: '8 weeks',
      prerequisites: 'Training data',
      contact: 'owner@example.com',
      benefits: ['Faster triage'],
      metrics: ['Cycle time'],
      risks: ['Model drift'],
      constraints: ['Legacy integration'],
      nextSteps: ['Pilot on one team'],
      dataSources: ['CRM'],
      dataObjects: ['Incoming tickets'],
      references: [{ title: 'Ref', url: 'https://example.test' }],
      valueScores: [{ axisId: 'business_value', rating: 55, description: 'High value' }],
      complexityScores: [{ axisId: 'implementation_effort', rating: 34, description: 'Moderate effort' }],
    };

    const { useCaseData, generatedUseCaseFields } = buildGeneratedUseCasePayloadForPersistence(
      {
        name: 'Existing name',
        description: 'Existing description',
        process: 'Legacy process',
        prerequisites: 'Legacy prerequisites',
      } as any,
      detail
    );

    expect(useCaseData.name).toBe('Existing name');
    expect(useCaseData.description).toBe('Existing description');
    expect(useCaseData.domain).toBe('Operations');
    expect(useCaseData.deadline).toBe('8 weeks');
    expect('process' in useCaseData).toBe(false);
    expect('prerequisites' in useCaseData).toBe(false);

    expect(generatedUseCaseFields).toEqual(
      expect.arrayContaining(['data.problem', 'data.solution', 'data.domain', 'data.deadline'])
    );
    expect(generatedUseCaseFields).not.toContain('data.process');
    expect(generatedUseCaseFields).not.toContain('data.prerequisites');
    expect(generatedUseCaseFields).not.toContain('data.name');
    expect(generatedUseCaseFields).not.toContain('data.description');
  });
});
