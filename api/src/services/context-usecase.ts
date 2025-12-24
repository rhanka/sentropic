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

const defaultUseCaseCount = 6;

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
  companyInfo?: string, 
  model?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseList> => {
  const useCaseListPrompt = defaultPrompts.find(p => p.id === 'use_case_list')?.content || '';
  
  if (!useCaseListPrompt) {
    throw new Error('Prompt use_case_list non trouvé');
  }

  const prompt = useCaseListPrompt
    .replace('{{user_input}}', input)
    .replace('{{company_info}}', companyInfo || 'Aucune information d\'entreprise disponible')
    .replace('{{use_case_count}}', String(defaultUseCaseCount));

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_list_${Date.now()}`;
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    responseFormat: 'json_object',
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
  companyInfo?: string,
  model?: string,
  signal?: AbortSignal,
  streamId?: string
): Promise<UseCaseDetail> => {
  const useCaseDetailPrompt = defaultPrompts.find(p => p.id === 'use_case_detail')?.content || '';
  
  if (!useCaseDetailPrompt) {
    throw new Error('Prompt use_case_detail non trouvé');
  }

  const prompt = useCaseDetailPrompt
    .replace(/\{\{use_case\}\}/g, useCase)
    .replace('{{user_input}}', context)
    .replace('{{company_info}}', companyInfo || 'Aucune information d\'entreprise disponible')
    .replace('{{matrix}}', JSON.stringify(matrix));

  // Générer un streamId si non fourni (pour utiliser executeWithToolsStream)
  const finalStreamId = streamId || `usecase_detail_${Date.now()}`;
  
  const { content } = await executeWithToolsStream(prompt, {
    model,
    useWebSearch: true,
    responseFormat: 'json_object',
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
      technologies: normalizeStringListField((detail as any)?.technologies),
      benefits: normalizeStringListField((detail as any)?.benefits),
      metrics: normalizeStringListField((detail as any)?.metrics),
      risks: normalizeStringListField((detail as any)?.risks),
      nextSteps: normalizeStringListField((detail as any)?.nextSteps),
      dataSources: normalizeStringListField((detail as any)?.dataSources),
      dataObjects: normalizeStringListField((detail as any)?.dataObjects),
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
