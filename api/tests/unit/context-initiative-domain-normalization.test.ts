import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/tools', () => ({
  executeWithToolsStream: vi.fn(),
}));

import { executeWithToolsStream } from '../../src/services/tools';
import { generateInitiativeList } from '../../src/services/context-initiative';
import type { InitiativeDetail } from '../../src/services/context-initiative';
import {
  buildDomainLabelMap,
  resolveDomainLabel,
  buildGeneratedInitiativePayloadForPersistence,
} from '../../src/services/queue-manager';

/**
 * BR40a-EX2 — normalize business domains at generation (approach A):
 * the LIST phase derives a 5-8 domain taxonomy; the DETAIL phase inherits it.
 */
describe('BR40a-EX2 business-domain normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('(a) list output exposes 5-8 domains and every case domainId references a defined domain', async () => {
    const executeWithToolsStreamMock = vi.mocked(executeWithToolsStream);
    const domains = [
      { id: 'production', label: 'Production' },
      { id: 'supply_chain', label: 'Supply chain' },
      { id: 'customer_service', label: 'Customer service' },
      { id: 'finance', label: 'Finance' },
      { id: 'hr', label: 'Human resources' },
      { id: 'rnd', label: 'R&D' },
    ];
    executeWithToolsStreamMock.mockResolvedValue({
      content: JSON.stringify({
        dossier: 'AI ideas for Acme',
        domains,
        initiatives: [
          { titre: 'Predictive maintenance', description: 'd', ref: '', domainId: 'production' },
          { titre: 'Demand forecasting', description: 'd', ref: '', domainId: 'supply_chain' },
          { titre: 'Support copilot', description: 'd', ref: '', domainId: 'customer_service' },
          { titre: 'Invoice triage', description: 'd', ref: '', domainId: 'finance' },
          { titre: 'CV screening', description: 'd', ref: '', domainId: 'hr' },
        ],
      }),
    } as Awaited<ReturnType<typeof executeWithToolsStream>>);

    const list = await generateInitiativeList('Generate ideas', 'Acme org info', 'gpt-4.1-nano', 5);

    expect(Array.isArray(list.domains)).toBe(true);
    expect(list.domains!.length).toBeGreaterThanOrEqual(5);
    expect(list.domains!.length).toBeLessThanOrEqual(8);

    const definedIds = new Set(list.domains!.map((d) => d.id));
    expect(list.initiatives.length).toBe(5);
    for (const item of list.initiatives) {
      expect(typeof item.domainId).toBe('string');
      expect(definedIds.has(item.domainId as string)).toBe(true);
    }
  });

  it('(b) draft initiative data.domain equals the resolved taxonomy label', async () => {
    const domainLabelById = buildDomainLabelMap([
      { id: 'production', label: 'Production' },
      { id: 'supply_chain', label: 'Supply chain' },
      // Defensive: malformed entries are ignored, not crashing.
      { id: '', label: 'Empty id' },
      { id: 'no_label' },
    ]);

    expect(domainLabelById.size).toBe(2);
    expect(resolveDomainLabel(domainLabelById, 'production')).toBe('Production');
    expect(resolveDomainLabel(domainLabelById, ' supply_chain ')).toBe('Supply chain');
    expect(resolveDomainLabel(domainLabelById, 'unknown_id')).toBeUndefined();
    expect(resolveDomainLabel(domainLabelById, undefined)).toBeUndefined();

    // Mirror the queue's draft build: data.domain is the resolved label.
    const resolved = resolveDomainLabel(domainLabelById, 'production');
    const draftData: Record<string, unknown> = {
      name: 'Predictive maintenance',
      description: 'd',
      ...(resolved ? { domain: resolved } : {}),
    };
    expect(draftData.domain).toBe('Production');
  });

  it('(c) detail generation preserves data.domain (no overwrite by the detail phase)', () => {
    const detail: InitiativeDetail = {
      name: 'Predictive maintenance',
      description: 'Detail description',
      problem: 'p',
      solution: 's',
      technologies: ['AI'],
      leadtime: '3 months',
      prerequisites: 'Data',
      contact: 'team@example.com',
      benefits: ['b'],
      metrics: ['m'],
      risks: ['r'],
      constraints: ['c'],
      nextSteps: ['n'],
      dataSources: ['ds'],
      dataObjects: ['do'],
      references: [],
      valueScores: [{ axisId: 'business_value', rating: 55, description: 'High value' }],
      complexityScores: [{ axisId: 'implementation_effort', rating: 34, description: 'Moderate' }],
    };

    const { initiativeData, generatedInitiativeFields } = buildGeneratedInitiativePayloadForPersistence(
      { name: 'Predictive maintenance', description: 'List description', domain: 'Production' },
      detail,
    );

    // The list-assigned label survives detail generation.
    expect(initiativeData.domain).toBe('Production');
    // domain unchanged -> not flagged as a freshly generated field.
    expect(generatedInitiativeFields).not.toContain('data.domain');
    // InitiativeDetail no longer carries a `domain` field at the type level.
    expect('domain' in detail).toBe(false);
  });
});
