import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/tools', () => ({
  executeWithToolsStream: vi.fn(),
}));

import { executeWithToolsStream } from '../../src/services/tools';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import { generateUseCaseDetail } from '../../src/services/context-usecase';

describe('generateUseCaseDetail payload contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns non-empty required scalar and list fields after normalization', async () => {
    const executeWithToolsStreamMock = vi.mocked(executeWithToolsStream);
    executeWithToolsStreamMock.mockResolvedValue({
      content: JSON.stringify({
        name: 'Predictive maintenance assistant',
        description: 'Detect machine anomalies before downtime.',
        problem: 'Unexpected outages create production losses.',
        solution: 'Use telemetry models to predict failures.',
        domain: 'Operations',
        technologies: ['- IoT sensors', '1. Time-series DB'],
        leadtime: '12 weeks',
        prerequisites: 'Telemetry ingestion pipeline',
        contact: 'ops@acme.test',
        benefits: ['- Reduced downtime', '- Better planning'],
        metrics: ['- MTTR reduction', '- Availability uplift'],
        risks: ['- False positives', '- Integration delays'],
        constraints: ['- Data quality variance', '- Legacy system limitations'],
        nextSteps: ['- Pilot on line A', '- Validate alerting workflow'],
        dataSources: ['- MES', '- ERP'],
        dataObjects: ['- Work orders', '- Sensor events'],
        references: [{ title: 'NIST guide', url: 'https://example.test/nist', excerpt: 'maintenance baseline' }],
        valueScores: [{ axisId: 'business_value', rating: 55, description: 'High expected business impact' }],
        complexityScores: [{ axisId: 'implementation_effort', rating: 34, description: 'Moderate delivery effort' }],
      }),
    } as Awaited<ReturnType<typeof executeWithToolsStream>>);

    const detail = await generateUseCaseDetail(
      'Predictive maintenance assistant',
      'Factory context',
      defaultMatrixConfig,
      'Acme org info',
      'gpt-4.1-nano'
    );

    const requiredScalars = [
      detail.name,
      detail.description,
      detail.problem,
      detail.solution,
      detail.domain,
      detail.leadtime,
      detail.prerequisites,
      detail.contact,
    ];
    expect(requiredScalars.every((value) => typeof value === 'string' && value.trim().length > 0)).toBe(true);

    const requiredLists = [
      detail.technologies,
      detail.benefits,
      detail.metrics,
      detail.risks,
      detail.constraints,
      detail.nextSteps,
      detail.dataSources,
      detail.dataObjects,
      detail.valueScores,
      detail.complexityScores,
    ];
    expect(requiredLists.every((value) => Array.isArray(value) && value.length > 0)).toBe(true);
  });

  it('rejects placeholder-only list items and backfills constraints when emptied by normalization', async () => {
    const executeWithToolsStreamMock = vi.mocked(executeWithToolsStream);
    executeWithToolsStreamMock.mockResolvedValue({
      content: JSON.stringify({
        name: 'Document classifier',
        description: 'Classify incoming documents automatically.',
        problem: 'Manual triage is slow and error-prone.',
        solution: 'Use ML classification with validation rules.',
        domain: 'Back office',
        technologies: ['- OCR', '1. NLP'],
        leadtime: '8 weeks',
        prerequisites: 'Labeled training corpus',
        contact: 'data@acme.test',
        benefits: ['-', '1.', '- Faster processing'],
        metrics: ['•', '1. Throughput increase'],
        risks: ['-', '- Misclassification spikes'],
        constraints: ['-', '1.'],
        nextSteps: ['-'],
        dataSources: ['- Inbound mailbox'],
        dataObjects: ['•', '- Document batches'],
        references: [{ title: 'ISO guidance', url: 'https://example.test/iso', excerpt: 'doc automation' }],
        valueScores: [{ axisId: 'business_value', rating: 34, description: 'Material value expected' }],
        complexityScores: [{ axisId: 'implementation_effort', rating: 21, description: 'Limited implementation effort' }],
      }),
    } as Awaited<ReturnType<typeof executeWithToolsStream>>);

    const detail = await generateUseCaseDetail(
      'Document classifier',
      'Operations context',
      defaultMatrixConfig,
      'Acme org info',
      'gpt-4.1-nano'
    );

    expect(detail.benefits).toEqual(['Faster processing']);
    expect(detail.metrics).toEqual(['Throughput increase']);
    expect(detail.risks).toEqual(['Misclassification spikes']);
    expect(detail.dataObjects).toEqual(['Document batches']);
    expect(detail.nextSteps).toEqual([]);

    expect(detail.constraints.length).toBeGreaterThan(0);
    expect(detail.constraints.every((item) => !/^\s*(?:[-*+•]|\d+\.)\s*$/.test(item))).toBe(true);
    expect(detail.constraints[0]).toContain('Contraintes de qualite');
  });
});
