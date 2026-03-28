import { executeWithToolsStream } from './tools';
import { getReasoningParamsForModel } from './model-catalog';
import { AI_IDEAS_AGENTS } from '../config/default-agents-ai-ideas';
import type { MatrixConfig } from '../types/matrix';

const getAgentPromptTemplate = (promptId: string): string => {
  for (const agent of AI_IDEAS_AGENTS) {
    if (agent.config.promptId === promptId) {
      return typeof agent.config.promptTemplate === 'string' ? agent.config.promptTemplate : '';
    }
  }
  return '';
};

const STRUCTURED_JSON_REPAIR_PROMPT = `You are a strict JSON repair engine.

Your task:
- Repair the malformed JSON response so it becomes one valid JSON object.
- Keep the original semantic intent and values as much as possible.
- Respect the target schema.
- Do not add commentary.

Target schema name:
{{schema_name}}

Target schema JSON:
{{schema_json}}

Malformed JSON response:
{{malformed_json}}

Rules:
- Return ONLY one valid JSON object.
- No markdown fences.
- No extra text before or after JSON.
- If a field is missing, infer the safest schema-compliant value from context.`;

export interface InitiativeListItem {
  titre: string;
  description: string; // 30-60 caractères (description courte)
  problem?: string; // 40-80 caractères (nouveau champ)
  solution?: string; // 40-80 caractères (nouveau champ)
  ref: string;
  organizationIds?: string[]; // optional — reserved for BR-20 workflow branching
  organizationName?: string; // optional — reserved for BR-20 workflow branching
}

export interface InitiativeList {
  dossier: string;
  initiatives: InitiativeListItem[];
}

export interface InitiativeDetail {
  name: string;
  description: string; // 30-60 caractères (description courte)
  problem?: string; // 40-80 caractères (nouveau champ)
  solution?: string; // 40-80 caractères (nouveau champ)
  domain: string;
  technologies: string[];
  leadtime: string;
  prerequisites: string;
  contact: string;
  benefits: string[];
  metrics: string[];
  risks: string[];
  constraints: string[];
  nextSteps: string[];
  dataSources: string[];
  dataObjects: string[];
  references: Array<{
    title: string;
    url: string;
    excerpt?: string;
  }>;
  valueScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
  complexityScores: Array<{
    axisId: string;
    rating: number;
    description: string;
  }>;
}

// UI (/dossier/new) default is 10; keep backend consistent.
const defaultInitiativeCount = 10;

const UNICODE_BULLETS = '[\\u2022\\u2023\\u25e6\\u25aa\\u25ab\\u2023\\u25cf\\u25e6]'; // • ▣ ◦ ▪ ▫ ‣ ● ◦
const BULLET_PREFIX_RE = new RegExp(`^\\s*(?:[-*+]|(?:\\d+\\.)|${UNICODE_BULLETS})\\s+`);
const MARKER_ONLY_RE = new RegExp(`^\\s*(?:[-*+]|${UNICODE_BULLETS})\\s*$`);
const NUMBER_MARKER_ONLY_RE = /^\s*\d+\.\s*$/;
const HEADING_PREFIX_RE = /^\s*#{1,6}\s+/;

function inlineHeadingPrefix(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n');
  if (!HEADING_PREFIX_RE.test(normalized)) return input;

  const lines = normalized.split('\n');
  if (lines.length === 0) return input;

  const first = lines[0] ?? '';
  const restLines = lines.slice(1);

  const withoutHashes = first.replace(HEADING_PREFIX_RE, '').trim();
  if (!withoutHashes) return input;

  // Heuristic: bold the "heading title" part, keep the remainder (if any) as normal text.
  // - Prefer splitting on ":" or "—" or " - " to avoid bolding a whole long sentence.
  const match = withoutHashes.match(/^(.*?)(\s*(?::|—| - )\s*)(.*)$/);
  const title = (match?.[1] ?? withoutHashes).trim();
  const sep = match?.[2] ?? '';
  const tail = match?.[3] ?? '';

  const rebuiltFirst =
    title
      ? (tail ? `**${title}**${sep}${tail}` : `**${title}**`)
      : withoutHashes;

  return [rebuiltFirst, ...restLines].join('\n').trim();
}

function normalizeOneListItem(raw: string): string[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  // Split multi-line markdown lists into separate array items when bullet lines are present.
  const lines = normalized.split('\n');
  const hasBulletLines = lines.some((l) => BULLET_PREFIX_RE.test(l.trim()));

  const clean = (s: string): string[] => {
    let t = s.trim();
    if (!t) return [];
    if (MARKER_ONLY_RE.test(t) || NUMBER_MARKER_ONLY_RE.test(t)) return [];
    // Strip a single leading list marker (e.g. "- ", "1. ", "• ") to avoid nested/empty bullets.
    t = t.replace(BULLET_PREFIX_RE, '').trim();
    if (!t) return [];
    if (MARKER_ONLY_RE.test(t) || NUMBER_MARKER_ONLY_RE.test(t)) return [];
    // Convert markdown headings at the start of an item (##..######) into inline bold.
    t = inlineHeadingPrefix(t);
    return [t];
  };

  if (!hasBulletLines) {
    return clean(normalized);
  }

  const items: string[] = [];
  let current: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Skip standalone list markers that may appear as separate lines (e.g. "-" or "1.").
    if (MARKER_ONLY_RE.test(line) || NUMBER_MARKER_ONLY_RE.test(line)) {
      continue;
    }

    if (BULLET_PREFIX_RE.test(line)) {
      if (current && current.trim()) items.push(current.trim());
      current = line.replace(BULLET_PREFIX_RE, '').trim();
      continue;
    }

    // Continuation line (kept as markdown, on a new line).
    current = current ? `${current}\n${line}` : line;
  }

  if (current && current.trim()) items.push(current.trim());

  return items.flatMap(clean);
}

/**
 * Normalizes a "string list" field returned by the LLM:
 * - removes marker-only entries ("-", "*", "•", "1.", empty)
 * - strips a single leading bullet/number prefix ("- ", "1. ", "• ") from each item
 * - splits multi-line markdown bullet blocks into separate items
 */
export function normalizeStringListField(value: unknown): string[] {
  const rawItems: string[] = Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v : String(v)))
    : typeof value === 'string'
      ? [value]
      : value == null
        ? []
        : [String(value)];

  return rawItems.flatMap(normalizeOneListItem);
}

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

type StructuredOutputConfig = {
  name: string;
  strict: true;
  schema: Record<string, unknown>;
};

/** @deprecated Fallback only — schema now comes from agent config.outputSchema */
const USE_CASE_LIST_STRUCTURED_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dossier: { type: 'string' },
    initiatives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          titre: { type: 'string' },
          description: { type: 'string' },
          ref: { type: 'string' },
        },
        required: ['titre', 'description', 'ref'],
      },
    },
  },
  required: ['dossier', 'initiatives'],
};

/** @deprecated Fallback only — schema now comes from agent config.outputSchema */
const USE_CASE_DETAIL_STRUCTURED_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    problem: { type: 'string' },
    solution: { type: 'string' },
    domain: { type: 'string' },
    technologies: { type: 'array', items: { type: 'string' } },
    leadtime: { type: 'string' },
    prerequisites: { type: 'string' },
    contact: { type: 'string' },
    benefits: { type: 'array', items: { type: 'string' } },
    metrics: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    constraints: {
      type: 'array',
      minItems: 1,
      items: { type: 'string', minLength: 3 },
    },
    nextSteps: { type: 'array', items: { type: 'string' } },
    references: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          url: { type: 'string' },
          excerpt: { type: 'string' },
        },
        required: ['title', 'url', 'excerpt'],
      },
    },
    valueScores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          axisId: { type: 'string' },
          rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
          description: { type: 'string' },
        },
        required: ['axisId', 'rating', 'description'],
      },
    },
    complexityScores: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          axisId: { type: 'string' },
          rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
          description: { type: 'string' },
        },
        required: ['axisId', 'rating', 'description'],
      },
    },
  },
  required: [
    'name',
    'description',
    'problem',
    'solution',
    'domain',
    'technologies',
    'leadtime',
    'prerequisites',
    'contact',
    'benefits',
    'metrics',
    'risks',
    'constraints',
    'nextSteps',
    'references',
    'valueScores',
    'complexityScores',
  ],
};

const isGeminiModel = (model?: string): boolean => {
  return typeof model === 'string' && model.trim().toLowerCase().startsWith('gemini');
};

const isGeminiResponseSchemaCompatibilityError = (error: unknown): boolean => {
  const message =
    error instanceof Error ? error.message : String(error ?? '');
  return (
    /generation_config\.response_schema/i.test(message) &&
    (/Unknown name/i.test(message) || /Cannot find field/i.test(message))
  );
};

const executeStructuredGenerationWithGeminiFallback = async (params: {
  prompt: string;
  model?: string;
  useDocuments: boolean;
  documentsContexts?: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'initiative'; contextId: string }>;
  structuredOutput: StructuredOutputConfig;
  promptId: string;
  streamId: string;
  reasoningSummary?: 'auto' | 'concise' | 'detailed';
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high' | 'xhigh';
  signal?: AbortSignal;
}): Promise<string> => {
  const baseOptions = {
    model: params.model,
    useWebSearch: true,
    useDocuments: params.useDocuments,
    documentsContexts: params.documentsContexts,
    responseFormat: 'json_object' as const,
    ...(params.reasoningSummary ? { reasoningSummary: params.reasoningSummary } : {}),
    ...(params.reasoningEffort ? { reasoningEffort: params.reasoningEffort } : {}),
    promptId: params.promptId,
    streamId: params.streamId,
    signal: params.signal,
  };

  try {
    const { content } = await executeWithToolsStream(params.prompt, {
      ...baseOptions,
      structuredOutput: params.structuredOutput,
    });
    return content;
  } catch (error) {
    if (!isGeminiModel(params.model) || !isGeminiResponseSchemaCompatibilityError(error)) {
      throw error;
    }
    const { content } = await executeWithToolsStream(params.prompt, baseOptions);
    return content;
  }
};

const parseStructuredJsonWithSingleRepair = async <T>(params: {
  rawContent: string;
  model?: string;
  schemaName: string;
  schema: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<T> => {
  try {
    return parseJsonLenient<T>(params.rawContent);
  } catch {
    const repairPromptTemplate = STRUCTURED_JSON_REPAIR_PROMPT;
    if (!repairPromptTemplate) {
      throw new Error('Prompt structured_json_repair non trouvé');
    }

    const repairPrompt = repairPromptTemplate
      .replace('{{schema_name}}', params.schemaName)
      .replace('{{schema_json}}', JSON.stringify(params.schema, null, 2))
      .replace('{{malformed_json}}', params.rawContent);

    const { content: repairedContent } = await executeWithToolsStream(repairPrompt, {
      model: params.model,
      useWebSearch: false,
      responseFormat: 'json_object',
      promptId: 'structured_json_repair',
      signal: params.signal,
    });
    if (!repairedContent) {
      throw new Error('Aucune réponse reçue lors de la tentative de réparation JSON');
    }
    return parseJsonLenient<T>(repairedContent);
  }
};

/**
 * Générer une liste de cas d'usage
 */
export const generateInitiativeList = async (
  input: string, 
  organizationInfo?: string, 
  model?: string,
  initiativeCount?: number,
  folderName?: string,
  documentsContexts?: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'initiative'; contextId: string }>,
  documentsContextJson?: string,
  signal?: AbortSignal,
  streamId?: string,
  runtimePrompt?: {
    promptTemplate?: string;
    promptId?: string;
  },
  outputSchema?: Record<string, unknown>,
): Promise<InitiativeList> => {
  const initiativeListPrompt =
    (typeof runtimePrompt?.promptTemplate === 'string' &&
    runtimePrompt.promptTemplate.trim().length > 0
      ? runtimePrompt.promptTemplate
      : getAgentPromptTemplate('use_case_list')) || '';
  
  if (!initiativeListPrompt) {
    throw new Error('Prompt use_case_list non trouvé');
  }

  const basePrompt = initiativeListPrompt
    .replace('{{user_input}}', input)
    .replace('{{folder_name}}', folderName || '')
    .replace('{{organization_info}}', organizationInfo || 'Aucune information d\'organisation disponible')
    .replace('{{use_case_count}}', String(initiativeCount ?? defaultInitiativeCount));

  const docsDirective =
    documentsContexts && documentsContexts.length > 0
      ? `\n\nDOCUMENTS & WEB (règles)\n- Les documents (liste + résumés) sont fournis dans DOCUMENTS_CONTEXT_JSON ci-dessous.\n- Contextes autorisés si un approfondissement est nécessaire:\n${documentsContexts
          .map((c) => `  - contextType="${c.contextType}" contextId="${c.contextId}"`)
          .join('\n')}\n- Commencer par exploiter les documents fournis (résumés, puis outil documents si nécessaire).\n  - Si les résumés suffisent, NE PAS appeler l'outil documents.\n  - Si besoin de détails factuels (chiffres, citations, sections précises), appeler documents.get_content (maxChars=30000) ou documents.analyze (question ciblée).\n- En complément, effectuer AU MOINS un web_search pour consolider les références externes pertinentes des cas d'usage (surtout si la demande exige un panachage “rapport + web”).\n- Utiliser web_extract uniquement si besoin de détails complémentaires spécifiques, et uniquement avec des URLs valides (obtenues via web_search).`
      : '';

  const docsJsonBlock =
    documentsContextJson && documentsContextJson.trim()
      ? `\n\nDOCUMENTS_CONTEXT_JSON:\n${documentsContextJson}\n`
      : '';

  const prompt = `${basePrompt}${docsDirective}${docsJsonBlock}`;

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_list_${Date.now()}`;
  const runtimePromptId =
    typeof runtimePrompt?.promptId === 'string' && runtimePrompt.promptId.trim().length > 0
      ? runtimePrompt.promptId.trim()
      : 'use_case_list';
  
  const resolvedListSchema = outputSchema ?? USE_CASE_LIST_STRUCTURED_SCHEMA;

  const content = await executeStructuredGenerationWithGeminiFallback({
    prompt,
    model,
    useDocuments: Boolean(documentsContexts && documentsContexts.length > 0),
    documentsContexts,
    structuredOutput: {
      name: 'use_case_list',
      strict: true,
      schema: resolvedListSchema,
    },
    ...getReasoningParamsForModel(model, 'high', 'detailed'),
    promptId: runtimePromptId,
    streamId: finalStreamId,
    signal,
  });

  if (!content) throw new Error('Aucune réponse reçue pour la liste de cas d\'usage');

  try {
    return await parseStructuredJsonWithSingleRepair<InitiativeList>({
      rawContent: content,
      model,
      schemaName: 'use_case_list',
      schema: resolvedListSchema,
      signal,
    });
  } catch (e) {
    console.error('Erreur de parsing JSON pour la liste:', e);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA pour la liste');
  }
};

/**
 * Générer le détail d'un cas d'usage
 */
export const generateInitiativeDetail = async (
  initiative: string,
  context: string,
  matrix: MatrixConfig,
  organizationInfo?: string,
  model?: string,
  documentsContexts?: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'initiative'; contextId: string }>,
  documentsContextJson?: string,
  signal?: AbortSignal,
  streamId?: string,
  runtimePrompt?: {
    promptTemplate?: string;
    promptId?: string;
  },
  options?: {
    excludeFields?: string[];
  },
  outputSchema?: Record<string, unknown>,
): Promise<InitiativeDetail> => {
  const initiativeDetailPrompt =
    (typeof runtimePrompt?.promptTemplate === 'string' &&
    runtimePrompt.promptTemplate.trim().length > 0
      ? runtimePrompt.promptTemplate
      : getAgentPromptTemplate('use_case_detail')) || '';
  
  if (!initiativeDetailPrompt) {
    throw new Error('Prompt use_case_detail non trouvé');
  }

  const basePrompt = initiativeDetailPrompt
    .replace(/\{\{use_case\}\}/g, initiative)
    .replace('{{user_input}}', context)
    .replace('{{organization_info}}', organizationInfo || 'Aucune information d\'organisation disponible')
    .replace('{{matrix}}', JSON.stringify(matrix));

  const docsDirective =
    documentsContexts && documentsContexts.length > 0
      ? `\n\nDOCUMENTS & WEB (règles)\n- Les documents (liste + résumés) sont fournis dans DOCUMENTS_CONTEXT_JSON ci-dessous.\n- Contextes autorisés si un approfondissement est nécessaire:\n${documentsContexts
          .map((c) => `  - contextType="${c.contextType}" contextId="${c.contextId}"`)
          .join('\n')}\n- Commencer par exploiter les documents fournis (résumés, puis outil documents si nécessaire).\n  - Si les résumés suffisent, NE PAS appeler l'outil documents.\n  - Si besoin de détails factuels (chiffres, citations, sections précises), appeler documents.get_content (maxChars=30000) ou documents.analyze (question ciblée).\n- En complément, effectuer AU MOINS un web_search pour consolider les références externes pertinentes des cas d'usage (surtout si la demande exige un panachage “rapport + web”).\n- Utiliser web_extract uniquement si besoin de détails complémentaires spécifiques, et uniquement avec des URLs valides (obtenues via web_search).`
      : '';

  const docsJsonBlock =
    documentsContextJson && documentsContextJson.trim()
      ? `\n\nDOCUMENTS_CONTEXT_JSON:\n${documentsContextJson}\n`
      : '';

  const prompt = `${basePrompt}${docsDirective}${docsJsonBlock}`;

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_detail_${Date.now()}`;
  const runtimePromptId =
    typeof runtimePrompt?.promptId === 'string' && runtimePrompt.promptId.trim().length > 0
      ? runtimePrompt.promptId.trim()
      : 'use_case_detail';
  
  const resolvedDetailSchema = outputSchema ?? USE_CASE_DETAIL_STRUCTURED_SCHEMA;

  const content = await executeStructuredGenerationWithGeminiFallback({
    prompt,
    model,
    useDocuments: Boolean(documentsContexts && documentsContexts.length > 0),
    documentsContexts,
    structuredOutput: {
      name: 'use_case_detail',
      strict: true,
      schema: resolvedDetailSchema,
    },
    ...getReasoningParamsForModel(model, 'high', 'detailed'),
    promptId: runtimePromptId,
    streamId: finalStreamId,
    signal,
  });

  if (!content) throw new Error(`Aucune réponse reçue pour le cas d'usage: ${initiative}`);

  try {
    const detail = await parseStructuredJsonWithSingleRepair<InitiativeDetail>({
      rawContent: content,
      model,
      schemaName: 'use_case_detail',
      schema: resolvedDetailSchema,
      signal,
    });
    // Normalize list fields to avoid marker-only entries and nested bullet formatting.
    const normalized = {
      ...detail,
      technologies: normalizeStringListField(detail?.technologies),
      benefits: normalizeStringListField(detail?.benefits),
      metrics: normalizeStringListField(detail?.metrics),
      risks: normalizeStringListField(detail?.risks),
      constraints: normalizeStringListField(detail?.constraints),
      nextSteps: normalizeStringListField(detail?.nextSteps),
      ...(detail?.dataSources != null ? { dataSources: normalizeStringListField(detail.dataSources) } : {}),
      ...(detail?.dataObjects != null ? { dataObjects: normalizeStringListField(detail.dataObjects) } : {}),
    };

    // Safety net: constraints are mandatory for the product workflow.
    // Some models occasionally return marker-only values ("-", "—") which are stripped by normalization.
    if (!normalized.constraints || normalized.constraints.length === 0) {
      normalized.constraints = [
        'Contraintes de qualite/disponibilite des donnees et de gouvernance (acces, RGPD, anonymisation).',
        "Contraintes d'integration et de securite (SI existant, IAM, conformite, performance).",
        "Contraintes de conduite du changement (process, formation, adoption par les equipes).",
      ];
    }

    return normalized;
  } catch (e) {
    console.error('Erreur de parsing JSON pour le détail:', e);
    console.error('Contenu reçu (premiers 500 chars):', content.substring(0, 500));
    console.error('Contenu reçu (derniers 500 chars):', content.substring(Math.max(0, content.length - 500)));
    console.error('Longueur du contenu:', content.length);
    console.error('Type de contenu:', typeof content);
    throw new Error(`Erreur lors du parsing de la réponse de l'IA pour le détail: ${initiative}`);
  }
};
