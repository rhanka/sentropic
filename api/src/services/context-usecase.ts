import { executeWithToolsStream } from './tools';
import { defaultPrompts } from '../config/default-prompts';
import type { MatrixConfig } from '../types/matrix';

export interface UseCaseListItem {
  titre: string;
  description: string; // 30-60 caractères (description courte)
  problem?: string; // 40-80 caractères (nouveau champ)
  solution?: string; // 40-80 caractères (nouveau champ)
  ref: string;
}

export interface UseCaseList {
  dossier: string;
  useCases: UseCaseListItem[];
}

export interface UseCaseDetail {
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
const defaultUseCaseCount = 10;

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

/**
 * Générer une liste de cas d'usage
 */
export const generateUseCaseList = async (
  input: string, 
  organizationInfo?: string, 
  model?: string,
  useCaseCount?: number,
  folderName?: string,
  documentsContexts?: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'usecase'; contextId: string }>,
  documentsContextJson?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseList> => {
  const useCaseListPrompt = defaultPrompts.find(p => p.id === 'use_case_list')?.content || '';
  
  if (!useCaseListPrompt) {
    throw new Error('Prompt use_case_list non trouvé');
  }

  const basePrompt = useCaseListPrompt
    .replace('{{user_input}}', input)
    .replace('{{folder_name}}', folderName || '')
    .replace('{{organization_info}}', organizationInfo || 'Aucune information d\'organisation disponible')
    .replace('{{use_case_count}}', String(useCaseCount ?? defaultUseCaseCount));

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
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    useDocuments: Boolean(documentsContexts && documentsContexts.length > 0),
    documentsContexts,
    responseFormat: 'json_object',
    structuredOutput: {
      name: 'use_case_list',
      strict: true,
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dossier: { type: 'string' },
          useCases: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                titre: { type: 'string' },
                description: { type: 'string' },
                ref: { type: 'string' }
              },
              required: ['titre', 'description', 'ref']
            }
          }
        },
        required: ['dossier', 'useCases']
      }
    },
    reasoningSummary: 'auto',
    promptId: 'use_case_list',
    streamId: finalStreamId,
    signal
  });
  
  if (!content) throw new Error('Aucune réponse reçue pour la liste de cas d\'usage');
  
  try {
    return parseJsonLenient<UseCaseList>(content);
  } catch (e) {
    console.error('Erreur de parsing JSON pour la liste:', e);
    console.error('Contenu reçu:', content);
    throw new Error('Erreur lors du parsing de la réponse de l\'IA pour la liste');
  }
};

/**
 * Générer le détail d'un cas d'usage
 */
export const generateUseCaseDetail = async (
  useCase: string,
  context: string,
  matrix: MatrixConfig,
  organizationInfo?: string,
  model?: string,
  documentsContexts?: Array<{ workspaceId: string; contextType: 'organization' | 'folder' | 'usecase'; contextId: string }>,
  documentsContextJson?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseDetail> => {
  const useCaseDetailPrompt = defaultPrompts.find(p => p.id === 'use_case_detail')?.content || '';
  
  if (!useCaseDetailPrompt) {
    throw new Error('Prompt use_case_detail non trouvé');
  }

  const basePrompt = useCaseDetailPrompt
    .replace(/\{\{use_case\}\}/g, useCase)
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
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    useDocuments: Boolean(documentsContexts && documentsContexts.length > 0),
    documentsContexts,
    responseFormat: 'json_object',
    structuredOutput: {
      name: 'use_case_detail',
      strict: true,
      schema: {
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
          nextSteps: { type: 'array', items: { type: 'string' } },
          dataSources: { type: 'array', items: { type: 'string' } },
          dataObjects: { type: 'array', items: { type: 'string' } },
          references: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string' },
                url: { type: 'string' },
                excerpt: { type: 'string' }
              },
              required: ['title', 'url', 'excerpt']
            }
          },
          valueScores: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string' },
                rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
                description: { type: 'string' }
              },
              required: ['axisId', 'rating', 'description']
            }
          },
          complexityScores: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                axisId: { type: 'string' },
                rating: { type: 'number', enum: [0, 1, 3, 5, 8, 13, 21, 34, 55, 89, 100] },
                description: { type: 'string' }
              },
              required: ['axisId', 'rating', 'description']
            }
          }
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
          'nextSteps',
          'dataSources',
          'dataObjects',
          'references',
          'valueScores',
          'complexityScores'
        ]
      }
    },
    reasoningSummary: 'auto',
    promptId: 'use_case_detail',
    streamId: finalStreamId,
    signal
  });
  
  if (!content) throw new Error(`Aucune réponse reçue pour le cas d'usage: ${useCase}`);
  
  try {
    const detail = parseJsonLenient<UseCaseDetail>(content);
    // Normalize list fields to avoid marker-only entries and nested bullet formatting.
    return {
      ...detail,
      technologies: normalizeStringListField(detail?.technologies),
      benefits: normalizeStringListField(detail?.benefits),
      metrics: normalizeStringListField(detail?.metrics),
      risks: normalizeStringListField(detail?.risks),
      nextSteps: normalizeStringListField(detail?.nextSteps),
      dataSources: normalizeStringListField(detail?.dataSources),
      dataObjects: normalizeStringListField(detail?.dataObjects),
    };
  } catch (e) {
    console.error('Erreur de parsing JSON pour le détail:', e);
    console.error('Contenu reçu (premiers 500 chars):', content.substring(0, 500));
    console.error('Contenu reçu (derniers 500 chars):', content.substring(Math.max(0, content.length - 500)));
    console.error('Longueur du contenu:', content.length);
    console.error('Type de contenu:', typeof content);
    throw new Error(`Erreur lors du parsing de la réponse de l'IA pour le détail: ${useCase}`);
  }
};
