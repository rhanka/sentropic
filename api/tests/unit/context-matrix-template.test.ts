import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/tools', () => ({
  executeWithToolsStream: vi.fn(),
}));

import { executeWithToolsStream } from '../../src/services/tools';
import { defaultMatrixConfig } from '../../src/config/default-matrix';
import { generateOrganizationMatrixTemplate } from '../../src/services/context-matrix';

const MATRIX_TEMPLATE_RESPONSE = {
  valueAxes: [
    {
      axisId: 'business_value',
      levelDescriptions: [
        { level: 1, description: 'Very low business impact' },
        { level: 2, description: 'Limited business impact' },
        { level: 3, description: 'Moderate business impact' },
        { level: 4, description: 'High business impact' },
        { level: 5, description: 'Critical business impact' },
      ],
    },
    {
      axisId: 'time_criticality',
      levelDescriptions: [
        { level: 1, description: 'No urgency for deployment' },
        { level: 2, description: 'Low urgency for deployment' },
        { level: 3, description: 'Moderate urgency for deployment' },
        { level: 4, description: 'High urgency for deployment' },
        { level: 5, description: 'Immediate urgency for deployment' },
      ],
    },
    {
      axisId: 'risk_reduction_opportunity',
      levelDescriptions: [
        { level: 1, description: 'No measurable risk reduction' },
        { level: 2, description: 'Minor risk reduction expected' },
        { level: 3, description: 'Moderate risk reduction expected' },
        { level: 4, description: 'High risk reduction expected' },
        { level: 5, description: 'Major risk reduction expected' },
      ],
    },
  ],
  complexityAxes: [
    {
      axisId: 'implementation_effort',
      levelDescriptions: [
        { level: 1, description: 'Very simple implementation effort' },
        { level: 2, description: 'Low implementation effort needed' },
        { level: 3, description: 'Moderate implementation effort needed' },
        { level: 4, description: 'High implementation effort needed' },
        { level: 5, description: 'Very high implementation effort needed' },
      ],
    },
    {
      axisId: 'data_compliance',
      levelDescriptions: [
        { level: 1, description: 'No major compliance constraints' },
        { level: 2, description: 'Limited compliance constraints' },
        { level: 3, description: 'Moderate compliance constraints' },
        { level: 4, description: 'Significant compliance constraints' },
        { level: 5, description: 'Critical compliance constraints' },
      ],
    },
    {
      axisId: 'data_availability',
      levelDescriptions: [
        { level: 1, description: 'Data is fully available and clean' },
        { level: 2, description: 'Data mostly available and usable' },
        { level: 3, description: 'Data partially available and fragmented' },
        { level: 4, description: 'Data difficult to collect and normalize' },
        { level: 5, description: 'Data unavailable or very poor quality' },
      ],
    },
    {
      axisId: 'change_management',
      levelDescriptions: [
        { level: 1, description: 'No significant change management effort' },
        { level: 2, description: 'Limited change management effort required' },
        { level: 3, description: 'Moderate change management effort required' },
        { level: 4, description: 'High change management effort required' },
        { level: 5, description: 'Major organizational change effort required' },
      ],
    },
  ],
};

describe('generateOrganizationMatrixTemplate prompt contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends expected prompt payload and options for organization_matrix_template', async () => {
    const executeWithToolsStreamMock = vi.mocked(executeWithToolsStream);
    executeWithToolsStreamMock.mockResolvedValue({
      content: JSON.stringify(MATRIX_TEMPLATE_RESPONSE),
    } as Awaited<ReturnType<typeof executeWithToolsStream>>);

    const result = await generateOrganizationMatrixTemplate(
      'Acme Instruments',
      '{"industry":"Electronics","objectives":["Improve quality"]}',
      defaultMatrixConfig,
      'gpt-4.1-nano'
    );

    expect(result.valueAxes).toHaveLength(3);
    expect(result.complexityAxes).toHaveLength(4);
    expect(result.valueAxes.every((axis) => axis.levelDescriptions.length === 5)).toBe(true);
    expect(result.complexityAxes.every((axis) => axis.levelDescriptions.length === 5)).toBe(true);

    expect(executeWithToolsStreamMock).toHaveBeenCalledTimes(1);
    const [prompt, options] = executeWithToolsStreamMock.mock.calls[0] ?? [];
    expect(typeof prompt).toBe('string');
    expect(String(prompt)).toContain('Acme Instruments');
    expect(String(prompt)).toContain('Electronics');
    expect(String(prompt)).toContain('business_value');
    expect(String(prompt)).toContain('change_management');

    expect(options?.promptId).toBe('organization_matrix_template');
    expect(options?.responseFormat).toBe('json_object');
    expect(options?.structuredOutput?.name).toBe('organization_matrix_template');
    expect(options?.structuredOutput?.strict).toBe(true);
  });
});
