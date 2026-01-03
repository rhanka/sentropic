import { executeWithToolsStream } from './tools';
import { defaultPrompts } from '../config/default-prompts';

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

  const organizationInfoPrompt = defaultPrompts.find(p => p.id === 'organization_info')?.content || '';
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
    const parsed = JSON.parse(content) as unknown;
    return coerceOrganizationData(parsed);
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
  const organizationInfoPrompt = defaultPrompts.find(p => p.id === 'organization_info')?.content || '';
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
    const cleaned = accumulatedContent
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const tryParse = (s: string) => JSON.parse(s);

    let parsedData: unknown;
    try {
      parsedData = tryParse(cleaned);
    } catch {
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        parsedData = tryParse(cleaned.slice(firstBrace, lastBrace + 1));
      } else {
        throw new Error('No JSON object boundaries found');
      }
    }

    return coerceOrganizationData(parsedData);
  } catch (parseError) {
    console.error('Erreur de parsing JSON:', parseError);
    console.error('Contenu reçu:', accumulatedContent);
    throw new Error("Erreur lors du parsing de la réponse de l'IA");
  }
};


