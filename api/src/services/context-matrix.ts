import { executeWithToolsStream } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import type { MatrixConfig } from '../types/matrix';

export type MatrixLevelDescription = {
  level: number;
  description: string;
};

export type MatrixAxisTemplate = {
  axisId: string;
  levelDescriptions: MatrixLevelDescription[];
};

export type OrganizationMatrixTemplate = {
  valueAxes: MatrixAxisTemplate[];
  complexityAxes: MatrixAxisTemplate[];
};

const VALUE_AXIS_IDS = ['business_value', 'time_criticality', 'risk_reduction_opportunity'] as const;
const COMPLEXITY_AXIS_IDS = ['implementation_effort', 'data_compliance', 'data_availability', 'change_management'] as const;

function parseJsonLenient<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Invalid JSON response');
  }
}

function normalizeAxisTemplate(
  value: unknown,
  allowedAxisIds: readonly string[]
): MatrixAxisTemplate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (item && typeof item === 'object' ? (item as Record<string, unknown>) : null))
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => {
      const axisId = typeof item.axisId === 'string' ? item.axisId : '';
      const levelDescriptions = Array.isArray(item.levelDescriptions)
        ? item.levelDescriptions
            .map((ld) => (ld && typeof ld === 'object' ? (ld as Record<string, unknown>) : null))
            .filter((ld): ld is Record<string, unknown> => !!ld)
            .map((ld) => ({
              level: Number(ld.level),
              description: typeof ld.description === 'string' ? ld.description.trim() : '',
            }))
            .filter((ld) => Number.isInteger(ld.level) && ld.level >= 1 && ld.level <= 5 && ld.description.length > 0)
            .sort((a, b) => a.level - b.level)
        : [];
      return { axisId, levelDescriptions };
    })
    .filter((axis) => allowedAxisIds.includes(axis.axisId) && axis.levelDescriptions.length === 5);
}

function validateExpectedAxes(template: OrganizationMatrixTemplate): void {
  const valueIds = new Set(template.valueAxes.map((axis) => axis.axisId));
  const complexityIds = new Set(template.complexityAxes.map((axis) => axis.axisId));

  const missingValue = VALUE_AXIS_IDS.filter((id) => !valueIds.has(id));
  const missingComplexity = COMPLEXITY_AXIS_IDS.filter((id) => !complexityIds.has(id));

  if (missingValue.length || missingComplexity.length) {
    throw new Error(
      `Incomplete matrix template output. Missing value axes: ${missingValue.join(', ') || 'none'}; missing complexity axes: ${missingComplexity.join(', ') || 'none'}`
    );
  }
}

export function mergeOrganizationMatrixTemplate(baseMatrix: MatrixConfig, template: OrganizationMatrixTemplate): MatrixConfig {
  const out = JSON.parse(JSON.stringify(baseMatrix)) as MatrixConfig;

  const apply = (axes: MatrixConfig['valueAxes'], generatedAxes: MatrixAxisTemplate[]) => {
    for (const generated of generatedAxes) {
      const target = axes.find((axis) => axis.id === generated.axisId);
      if (!target) continue;
      target.levelDescriptions = generated.levelDescriptions.map((ld) => ({
        level: ld.level,
        description: ld.description,
      }));
    }
  };

  apply(out.valueAxes, template.valueAxes);
  apply(out.complexityAxes, template.complexityAxes);
  return out;
}

export async function generateOrganizationMatrixTemplate(
  organizationName: string,
  organizationInfo: string,
  baseMatrix: MatrixConfig,
  model?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<OrganizationMatrixTemplate> {
  const promptTemplate = defaultPrompts.find((p) => p.id === 'organization_matrix_template')?.content || '';
  if (!promptTemplate) {
    throw new Error('Prompt organization_matrix_template non trouvé');
  }

  const prompt = promptTemplate
    .replace('{{organization_name}}', organizationName || 'Organisation')
    .replace('{{organization_info}}', organizationInfo || 'Aucune information organisationnelle disponible')
    .replace('{{base_matrix}}', JSON.stringify(baseMatrix));

  const isGpt5 = typeof model === 'string' && model.startsWith('gpt-5');
  const finalStreamId = streamId || `organization_matrix_${Date.now()}`;

  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: false,
    responseFormat: 'json_object',
    structuredOutput: {
      name: 'organization_matrix_template',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          valueAxes: {
            type: 'array',
            minItems: 3,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string', enum: [...VALUE_AXIS_IDS] },
                levelDescriptions: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      level: { type: 'number', enum: [1, 2, 3, 4, 5] },
                      description: { type: 'string', minLength: 8 },
                    },
                    required: ['level', 'description'],
                  },
                },
              },
              required: ['axisId', 'levelDescriptions'],
            },
          },
          complexityAxes: {
            type: 'array',
            minItems: 4,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string', enum: [...COMPLEXITY_AXIS_IDS] },
                levelDescriptions: {
                  type: 'array',
                  minItems: 5,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      level: { type: 'number', enum: [1, 2, 3, 4, 5] },
                      description: { type: 'string', minLength: 8 },
                    },
                    required: ['level', 'description'],
                  },
                },
              },
              required: ['axisId', 'levelDescriptions'],
            },
          },
        },
        required: ['valueAxes', 'complexityAxes'],
      },
    },
    ...(isGpt5 ? { reasoningSummary: 'detailed' as const, reasoningEffort: 'high' as const } : {}),
    promptId: 'organization_matrix_template',
    streamId: finalStreamId,
    signal,
  });

  if (!content) {
    throw new Error('Aucune réponse reçue pour la génération de matrice organisation');
  }

  const parsed = parseJsonLenient<OrganizationMatrixTemplate>(content);
  const normalized: OrganizationMatrixTemplate = {
    valueAxes: normalizeAxisTemplate(parsed?.valueAxes, VALUE_AXIS_IDS),
    complexityAxes: normalizeAxisTemplate(parsed?.complexityAxes, COMPLEXITY_AXIS_IDS),
  };
  validateExpectedAxes(normalized);
  return normalized;
}

