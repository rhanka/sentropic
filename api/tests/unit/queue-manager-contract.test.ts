import { describe, expect, it } from 'vitest';
import {
  buildGeneratedInitiativePayloadForPersistence,
  normalizeAutoGenerationSectionKeys,
  resolveGenerationPromptOverrideFromConfig,
} from '../../src/services/queue-manager';
import type { InitiativeDetail } from '../../src/services/context-initiative';

describe('queue manager contracts', () => {
  it('normalizes auto-comment section keys for each context', () => {
    expect(
      normalizeAutoGenerationSectionKeys('initiative', [
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
    const detail: InitiativeDetail = {
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

    const { initiativeData, generatedInitiativeFields } = buildGeneratedInitiativePayloadForPersistence(
      {
        name: 'Existing name',
        description: 'Existing description',
        process: 'Legacy process',
        prerequisites: 'Legacy prerequisites',
      } as any,
      detail
    );

    expect(initiativeData.name).toBe('Existing name');
    expect(initiativeData.description).toBe('Existing description');
    expect(initiativeData.domain).toBe('Operations');
    expect(initiativeData.deadline).toBe('8 weeks');
    expect('process' in initiativeData).toBe(false);
    expect('prerequisites' in initiativeData).toBe(false);

    expect(generatedInitiativeFields).toEqual(
      expect.arrayContaining(['data.problem', 'data.solution', 'data.domain', 'data.deadline'])
    );
    expect(generatedInitiativeFields).not.toContain('data.process');
    expect(generatedInitiativeFields).not.toContain('data.prerequisites');
    expect(generatedInitiativeFields).not.toContain('data.name');
    expect(generatedInitiativeFields).not.toContain('data.description');
  });

  it('extracts generation prompt override from agent config with fallback prompt id', () => {
    const configured = resolveGenerationPromptOverrideFromConfig(
      {
        promptId: 'agent.initiative_list.v2',
        promptTemplate: 'Template body',
      },
      'initiative_list',
    );
    expect(configured.promptId).toBe('agent.initiative_list.v2');
    expect(configured.promptTemplate).toBe('Template body');

    const fallback = resolveGenerationPromptOverrideFromConfig(
      {
        role: 'initiative_list_generation',
      },
      'initiative_list',
    );
    expect(fallback.promptId).toBe('initiative_list');
    expect(fallback.promptTemplate).toBeUndefined();
  });
});
