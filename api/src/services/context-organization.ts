import { executeWithToolsStream } from './tools';
import { ORGANIZATION_PROMPTS } from '../config/default-chat-system';

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

export interface OrganizationData {
  industry: string;
  size: string;
  products: string;
  processes: string;
  kpis: string;
  challenges: string;
  objectives: string;
  technologies: string;
  references?: Array<{ title: string; url: string; excerpt?: string }>;
}

function sanitizePgText(input: string): string {
  // PostgreSQL text/JSON cannot contain NUL (\u0000). Also strip other control chars that can break JSON ingestion.
  // Keep: \t \n \r.
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    // NUL is forbidden in Postgres text/json.
    if (code === 0) continue;
    // Strip other ASCII control chars except tab/newline/carriage return.
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) continue;
    out += input[i];
  }
  return out;
}

function normalizeOrganizationField(value: unknown): string {
  if (typeof value === 'string') return sanitizePgText(value);
  if (value === null || value === undefined) return '';
  try {
    return sanitizePgText(JSON.stringify(value));
  } catch {
    return sanitizePgText(String(value));
  }
}

function coerceOrganizationData(value: unknown): OrganizationData {
  const rec = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
  return {
    industry: normalizeOrganizationField(rec.industry),
    size: normalizeOrganizationField(rec.size),
    products: normalizeOrganizationField(rec.products),
    processes: normalizeOrganizationField(rec.processes),
    kpis: normalizeOrganizationField(rec.kpis),
    challenges: normalizeOrganizationField(rec.challenges),
    objectives: normalizeOrganizationField(rec.objectives),
    technologies: normalizeOrganizationField(rec.technologies),
    references: Array.isArray(rec.references)
      ? rec.references
          .map((r) => (r && typeof r === 'object' ? (r as Record<string, unknown>) : null))
          .filter((r): r is Record<string, unknown> => !!r)
          .map((r) => ({
            title: sanitizePgText(typeof r.title === 'string' ? r.title : String(r.title ?? '')),
            url: sanitizePgText(typeof r.url === 'string' ? r.url : String(r.url ?? '')),
            excerpt: typeof r.excerpt === 'string' ? sanitizePgText(r.excerpt) : undefined,
          }))
          .filter((r) => r.title.trim() && r.url.trim())
      : undefined
  };
}

function compactText(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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
    throw new Error('No JSON object boundaries found');
  }
}

function extractJsonStringField(rawContent: string, field: string): string {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = rawContent.match(new RegExp(`"${escapedField}"\\s*:\\s*"([^"]*)"`, 'i'));
  return match?.[1]?.trim() ?? '';
}

function extractReferenceUrls(rawContent: string): Array<{ title: string; url: string; excerpt?: string }> {
  const matches = Array.from(rawContent.matchAll(/https?:\/\/[^\s)"']+/g));
  const uniqueUrls = Array.from(new Set(matches.map((match) => match[0]))).slice(0, 5);
  return uniqueUrls.map((url) => ({
    title: url,
    url,
  }));
}

function buildOrganizationFallback(params: {
  organizationName: string;
  rawContent: string;
  existingData?: unknown;
}): OrganizationData {
  const existing = coerceOrganizationData(params.existingData);
  const excerpt = compactText(params.rawContent, 320);
  const infer = (field: keyof OrganizationData, fallback: string): string => {
    const extracted = extractJsonStringField(params.rawContent, field);
    const existingValue = existing[field];
    return extracted || (typeof existingValue === 'string' && existingValue.trim().length > 0 ? existingValue : fallback);
  };

  return {
    industry: infer('industry', 'Services'),
    size: infer('size', 'Informations non disponibles'),
    products: infer('products', `Offres et services liés à ${params.organizationName}.`),
    processes: infer('processes', `Processus métier et workflows opérationnels autour de ${params.organizationName}.`),
    kpis: infer('kpis', 'Temps de traitement, qualité de service, adoption, ROI.'),
    challenges: infer('challenges', `Contraintes d’intégration, de données et d’adoption pour ${params.organizationName}.`),
    objectives: infer('objectives', `Accélérer les gains opérationnels et la valeur métier via ${params.organizationName}.`),
    technologies: infer('technologies', excerpt || 'IA générative, automatisation, intégration SI.'),
    references: extractReferenceUrls(params.rawContent),
  };
}

async function parseOrganizationWithSingleRepair(params: {
  rawContent: string;
  model?: string;
  signal?: AbortSignal;
  organizationName: string;
  existingData?: unknown;
}): Promise<OrganizationData> {
  try {
    return coerceOrganizationData(parseJsonLenient<unknown>(params.rawContent));
  } catch {
    const repairPrompt = STRUCTURED_JSON_REPAIR_PROMPT
      .replace('{{schema_name}}', 'organization_info')
      .replace('{{schema_json}}', JSON.stringify({
        type: 'object',
        additionalProperties: true,
        properties: {
          industry: { type: 'string' },
          size: { type: 'string' },
          products: { type: 'string' },
          processes: { type: 'string' },
          kpis: { type: 'string' },
          challenges: { type: 'string' },
          objectives: { type: 'string' },
          technologies: { type: 'string' },
          references: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                excerpt: { type: 'string' },
              },
              required: ['title', 'url'],
            },
          },
        },
        required: ['industry', 'size', 'products', 'processes', 'kpis', 'challenges', 'objectives', 'technologies'],
      }, null, 2))
      .replace('{{malformed_json}}', params.rawContent);

    try {
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
      return coerceOrganizationData(parseJsonLenient<unknown>(repairedContent));
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const isProviderAbort = message.includes('request was aborted') || message.includes('aborterror');
      if (params.signal?.aborted && !isProviderAbort) {
        throw error;
      }
      return buildOrganizationFallback({
        organizationName: params.organizationName,
        rawContent: params.rawContent,
        existingData: params.existingData,
      });
    }
  }
}

// Configuration métier par défaut
const industries = {
  industries: [
    { name: 'Technologie' },
    { name: 'Santé' },
    { name: 'Finance' },
    { name: 'Éducation' },
    { name: 'Retail' },
    { name: 'Manufacturing' },
    { name: 'Services' },
    { name: 'Immobilier' },
    { name: 'Transport' },
    { name: 'Énergie' },
    { name: 'Agroalimentaire' },
    { name: 'Média' },
    { name: 'Télécommunications' },
    { name: 'Automobile' },
    { name: 'Aéronautique' }
  ]
};

/**
 * Enrichir une organisation avec l'IA
 * Si streamId est fourni, utilise le streaming et écrit les événements dans chat_stream_events
 */
export const enrichOrganization = async (
  organizationName: string,
  model?: string,
  signal?: AbortSignal,
  streamId?: string,
  opts?: {
    organizationId?: string;
    workspaceId?: string;
    existingData?: unknown;
    useDocuments?: boolean;
  }
): Promise<OrganizationData> => {
  // Si streamId est fourni, utiliser la version streaming
  if (streamId) {
    // enrichOrganizationStream attend : (organizationName, streamId, model, signal)
    // enrichOrganization reçoit : (organizationName, model, signal, streamId)
    return enrichOrganizationStream(organizationName, streamId, model, signal, opts);
  }

  const organizationInfoPrompt = ORGANIZATION_PROMPTS.organization_info || '';
  if (!organizationInfoPrompt) {
    throw new Error('Prompt organization_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = organizationInfoPrompt
    .replace('{{organization_name}}', organizationName)
    .replace('{{industries}}', industriesList)
    .replace('{{organization_id}}', (opts?.organizationId || '').trim() || 'Non précisé')
    .replace('{{existing_data}}', (() => {
      try { return JSON.stringify(opts?.existingData ?? {}, null, 2); } catch { return '{}'; }
    })());

  const finalStreamId = streamId || `organization_enrich_${Date.now()}`;
  const { content } = await executeWithToolsStream(prompt, {
    model: model || 'gpt-4.1-nano',
    useWebSearch: true,
    useDocuments: !!opts?.useDocuments,
    documentsContext:
      opts?.useDocuments && opts?.workspaceId && opts?.organizationId
        ? { workspaceId: opts.workspaceId, contextType: 'organization', contextId: opts.organizationId }
        : undefined,
    responseFormat: 'json_object',
    reasoningSummary: 'auto',
    promptId: 'organization_info',
    streamId: finalStreamId,
    signal
  });

  if (!content) {
    throw new Error("Aucune réponse reçue de l'IA");
  }

  try {
    return await parseOrganizationWithSingleRepair({
      rawContent: content,
      model,
      signal,
      organizationName,
      existingData: opts?.existingData,
    });
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', content);
    throw new Error("Erreur lors du parsing de la réponse de l'IA");
  }
};

/**
 * Enrichir une organisation avec l'IA en streaming
 */
export const enrichOrganizationStream = async (
  organizationName: string,
  streamId?: string,
  model?: string,
  signal?: AbortSignal,
  opts?: {
    organizationId?: string;
    workspaceId?: string;
    existingData?: unknown;
    useDocuments?: boolean;
  }
): Promise<OrganizationData> => {
  const organizationInfoPrompt = ORGANIZATION_PROMPTS.organization_info || '';
  if (!organizationInfoPrompt) {
    throw new Error('Prompt organization_info non trouvé');
  }

  const industriesList = industries.industries.map(i => i.name).join(', ');
  const prompt = organizationInfoPrompt
    .replace('{{organization_name}}', organizationName)
    .replace('{{industries}}', industriesList)
    .replace('{{organization_id}}', (opts?.organizationId || '').trim() || 'Non précisé')
    .replace('{{existing_data}}', (() => {
      try { return JSON.stringify(opts?.existingData ?? {}, null, 2); } catch { return '{}'; }
    })());

  const { content: accumulatedContent } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    useDocuments: !!opts?.useDocuments,
    documentsContext:
      opts?.useDocuments && opts?.workspaceId && opts?.organizationId
        ? { workspaceId: opts.workspaceId, contextType: 'organization', contextId: opts.organizationId }
        : undefined,
    responseFormat: 'json_object',
    reasoningSummary: 'detailed',
    promptId: 'organization_info',
    streamId,
    signal
  });

  if (!accumulatedContent) {
    throw new Error("Aucune réponse reçue de l'IA");
  }

  try {
    return await parseOrganizationWithSingleRepair({
      rawContent: accumulatedContent,
      model,
      signal,
      organizationName,
      existingData: opts?.existingData,
    });
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', accumulatedContent);
    throw new Error("Erreur lors du parsing de la réponse de l'IA");
  }
};

