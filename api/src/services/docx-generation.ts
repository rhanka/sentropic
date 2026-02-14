import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { folders, useCases } from '../db/schema';
import type { MatrixConfig } from '../types/matrix';
import type { ScoreEntry, UseCase, UseCaseData } from '../types/usecase';
import {
  type DocxEntityType,
  type DocxTemplateId,
  generateExecutiveSynthesisDocx,
  generateUseCaseDocx,
} from './docx-service';
import { parseMatrixConfig } from '../utils/matrix';
import { calculateUseCaseScores } from '../utils/scoring';

export type DocxGenerateRequest = {
  templateId: DocxTemplateId;
  entityType: DocxEntityType;
  entityId: string;
  workspaceId: string;
  provided?: Record<string, unknown>;
  controls?: Record<string, unknown>;
  locale?: string;
  requestId?: string;
  onProgress?: (event: {
    state: string;
    progress?: number;
    current?: number;
    total?: number;
    message?: string;
  }) => void | Promise<void>;
};

export type DocxGenerateResult = {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

type UseCaseOnePageSource = {
  useCase: UseCase;
  matrix: MatrixConfig | null;
};

type ExecutiveSynthesisSource = {
  folderName: string;
  executiveSummary: {
    introduction?: string;
    analyse?: string;
    recommandation?: string;
    synthese_executive?: string;
    references?: Array<{ title?: string; url?: string; excerpt?: string }>;
  };
  useCases: UseCase[];
  matrix: MatrixConfig | null;
};

type RegistryEntry = {
  entityType: DocxEntityType;
  generate: (input: DocxGenerateRequest) => Promise<DocxGenerateResult>;
};

type SerializedUseCase = typeof useCases.$inferSelect;

type LegacyUseCaseRow = SerializedUseCase & {
  name?: string | null;
  description?: string | null;
  process?: string | null;
  domain?: string | null;
  technologies?: string | null;
  prerequisites?: string | null;
  deadline?: string | null;
  contact?: string | null;
  benefits?: string | null;
  constraints?: string | null;
  metrics?: string | null;
  risks?: string | null;
  nextSteps?: string | null;
  dataSources?: string | null;
  dataObjects?: string | null;
  references?: string | null;
  valueScores?: string | null;
  complexityScores?: string | null;
};

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_TEMPLATES_DIR = resolve(__dirname, '../../templates');
const CWD_TEMPLATES_DIR = resolve(process.cwd(), 'templates');
const TEMPLATES_DIR = existsSync(CWD_TEMPLATES_DIR)
  ? CWD_TEMPLATES_DIR
  : MODULE_TEMPLATES_DIR;

function getTemplateFileName(templateId: DocxTemplateId): string {
  switch (templateId) {
    case 'usecase-onepage':
      return 'usecase-onepage.docx';
    case 'executive-synthesis-multipage':
      return 'executive-synthesis.docx';
    default:
      return `${templateId}.docx`;
  }
}

async function computeTemplateFingerprint(templateId: DocxTemplateId): Promise<string> {
  const templatePath = resolve(TEMPLATES_DIR, getTemplateFileName(templateId));
  const bytes = await readFile(templatePath);
  return createHash('sha256').update(bytes).digest('hex');
}

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value);
}

const parseJson = <T>(value: string | null | undefined): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

function extractUseCaseData(row: SerializedUseCase): Partial<UseCaseData> {
  let data: Partial<UseCaseData> = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as Partial<UseCaseData>;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as Partial<UseCaseData>;
    }
  } catch {
    data = {};
  }

  const legacyRow = row as LegacyUseCaseRow;
  if (!data.name && legacyRow.name) data.name = legacyRow.name;
  if (!data.description && legacyRow.description) data.description = legacyRow.description;
  if (!data.process && legacyRow.process) data.process = legacyRow.process;
  if (!data.domain && legacyRow.domain) data.domain = legacyRow.domain;
  if (!data.technologies && legacyRow.technologies) {
    data.technologies = parseJson<string[]>(legacyRow.technologies) ?? [];
  }
  if (!data.prerequisites && legacyRow.prerequisites) data.prerequisites = legacyRow.prerequisites;
  if (!data.deadline && legacyRow.deadline) data.deadline = legacyRow.deadline;
  if (!data.contact && legacyRow.contact) data.contact = legacyRow.contact;
  if (!data.benefits && legacyRow.benefits) {
    data.benefits = parseJson<string[]>(legacyRow.benefits) ?? [];
  }
  if (!data.constraints && legacyRow.constraints) {
    data.constraints = parseJson<string[]>(legacyRow.constraints) ?? [];
  }
  if (!data.metrics && legacyRow.metrics) {
    data.metrics = parseJson<string[]>(legacyRow.metrics) ?? [];
  }
  if (!data.risks && legacyRow.risks) {
    data.risks = parseJson<string[]>(legacyRow.risks) ?? [];
  }
  if (!data.nextSteps && legacyRow.nextSteps) {
    data.nextSteps = parseJson<string[]>(legacyRow.nextSteps) ?? [];
  }
  if (!data.dataSources && legacyRow.dataSources) {
    data.dataSources = parseJson<string[]>(legacyRow.dataSources) ?? [];
  }
  if (!data.dataObjects && legacyRow.dataObjects) {
    data.dataObjects = parseJson<string[]>(legacyRow.dataObjects) ?? [];
  }
  if (!data.references && legacyRow.references) {
    data.references =
      parseJson<Array<{ title: string; url: string; excerpt?: string }>>(legacyRow.references) ??
      [];
  }
  if (!data.valueScores && legacyRow.valueScores) {
    data.valueScores = parseJson<ScoreEntry[]>(legacyRow.valueScores) ?? [];
  }
  if (!data.complexityScores && legacyRow.complexityScores) {
    data.complexityScores = parseJson<ScoreEntry[]>(legacyRow.complexityScores) ?? [];
  }
  if (!data.name) data.name = "Cas d'usage sans nom";

  return data;
}

async function hydrateUseCase(row: SerializedUseCase): Promise<UseCase> {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, row.folderId), eq(folders.workspaceId, row.workspaceId)));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  const data = extractUseCaseData(row);
  const computedScores = calculateUseCaseScores(matrix, data as UseCaseData);

  return {
    id: row.id,
    folderId: row.folderId,
    organizationId: row.organizationId,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt,
    data: data as UseCaseData,
    totalValueScore: computedScores?.totalValueScore ?? null,
    totalComplexityScore: computedScores?.totalComplexityScore ?? null,
  };
}

async function hydrateUseCases(rows: SerializedUseCase[]): Promise<UseCase[]> {
  if (!rows.length) return [];

  const folderIds = [...new Set(rows.map((row) => row.folderId))];
  const foldersMap = new Map<string, typeof folders.$inferSelect>();
  const workspaceId = rows[0].workspaceId;

  for (const folderId of folderIds) {
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
    if (folder) foldersMap.set(folderId, folder);
  }

  return rows.map((row) => {
    const folder = foldersMap.get(row.folderId);
    const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
    const data = extractUseCaseData(row);
    const computedScores = calculateUseCaseScores(matrix, data as UseCaseData);

    return {
      id: row.id,
      folderId: row.folderId,
      organizationId: row.organizationId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data: data as UseCaseData,
      totalValueScore: computedScores?.totalValueScore ?? null,
      totalComplexityScore: computedScores?.totalComplexityScore ?? null,
    } satisfies UseCase;
  });
}

function normalizeForHash(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForHash(item));
  }
  if (typeof value === 'object') {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const keys = Object.keys(input).sort();
    for (const key of keys) {
      out[key] = normalizeForHash(input[key]);
    }
    return out;
  }
  return safeText(value);
}

function hashDocxSnapshot(snapshot: unknown): string {
  const normalized = normalizeForHash(snapshot);
  const serialized = JSON.stringify(normalized);
  return createHash('sha256').update(serialized).digest('hex');
}

/** Minimal slug helper (ASCII, lowercase, hyphens). */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

function parseExecutiveSummary(value: string | null): {
  introduction?: string;
  analyse?: string;
  recommandation?: string;
  synthese_executive?: string;
  references?: Array<{ title?: string; url?: string; excerpt?: string }>;
} {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const references = Array.isArray(parsed.references)
      ? parsed.references
          .map((reference) => {
            if (!reference || typeof reference !== 'object') return null;
            const item = reference as Record<string, unknown>;
            return {
              title: typeof item.title === 'string' ? item.title : '',
              url: typeof item.url === 'string' ? item.url : '',
              excerpt: typeof item.excerpt === 'string' ? item.excerpt : '',
            };
          })
          .filter(
            (
              reference
            ): reference is { title: string; url: string; excerpt: string } =>
              reference != null
          )
      : [];

    return {
      introduction: typeof parsed.introduction === 'string' ? parsed.introduction : '',
      analyse: typeof parsed.analyse === 'string' ? parsed.analyse : '',
      recommandation:
        typeof parsed.recommandation === 'string' ? parsed.recommandation : '',
      synthese_executive:
        typeof parsed.synthese_executive === 'string'
          ? parsed.synthese_executive
          : '',
      references,
    };
  } catch {
    return {};
  }
}

async function generateUseCaseOnePage(
  input: DocxGenerateRequest
): Promise<DocxGenerateResult> {
  const source = await loadUseCaseOnePageSource(input);
  const buffer = await generateUseCaseDocx(source.useCase, source.matrix);
  const nameSlug = slugify(source.useCase.data.name) || 'usecase';

  return {
    buffer,
    mimeType: DOCX_MIME,
    fileName: `usecase-${source.useCase.id}-${nameSlug}.docx`,
  };
}

async function loadUseCaseOnePageSource(
  input: DocxGenerateRequest
): Promise<UseCaseOnePageSource> {
  const [record] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, input.entityId), eq(useCases.workspaceId, input.workspaceId)));

  if (!record) {
    throw new Error('not_found');
  }

  const hydrated = await hydrateUseCase(record);
  const [folder] = await db
    .select({ matrixConfig: folders.matrixConfig })
    .from(folders)
    .where(and(eq(folders.id, hydrated.folderId), eq(folders.workspaceId, input.workspaceId)));

  return {
    useCase: hydrated,
    matrix: parseMatrixConfig(folder?.matrixConfig ?? null),
  };
}

async function generateExecutiveSynthesis(
  input: DocxGenerateRequest
): Promise<DocxGenerateResult> {
  const source = await loadExecutiveSynthesisSource(input);
  const buffer = await generateExecutiveSynthesisDocx({
    folderName: source.folderName,
    executiveSummary: source.executiveSummary,
    useCases: source.useCases,
    matrix: source.matrix,
    provided: input.provided ?? {},
    controls: input.controls ?? {},
    locale: input.locale,
    requestId: input.requestId,
    onProgress: input.onProgress,
  });

  const folderSlug = slugify(source.folderName) || 'folder';
  return {
    buffer,
    mimeType: DOCX_MIME,
    fileName: `executive-synthesis-${input.entityId}-${folderSlug}.docx`,
  };
}

async function loadExecutiveSynthesisSource(
  input: DocxGenerateRequest
): Promise<ExecutiveSynthesisSource> {
  const [folder] = await db
    .select({
      id: folders.id,
      name: folders.name,
      matrixConfig: folders.matrixConfig,
      executiveSummary: folders.executiveSummary,
    })
    .from(folders)
    .where(and(eq(folders.id, input.entityId), eq(folders.workspaceId, input.workspaceId)));

  if (!folder) {
    throw new Error('not_found');
  }

  const rows = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.folderId, folder.id), eq(useCases.workspaceId, input.workspaceId)))
    .orderBy(asc(useCases.createdAt));

  const hydratedUseCases = await hydrateUseCases(rows);
  const matrix = parseMatrixConfig(folder.matrixConfig ?? null);

  return {
    folderName: folder.name,
    executiveSummary: parseExecutiveSummary(folder.executiveSummary ?? null),
    useCases: hydratedUseCases,
    matrix,
  };
}

const registry: Record<DocxTemplateId, RegistryEntry> = {
  'usecase-onepage': {
    entityType: 'usecase',
    generate: generateUseCaseOnePage,
  },
  'executive-synthesis-multipage': {
    entityType: 'folder',
    generate: generateExecutiveSynthesis,
  },
};

export function getExpectedEntityType(templateId: DocxTemplateId): DocxEntityType {
  return registry[templateId].entityType;
}

export async function generateDocxForEntity(
  input: DocxGenerateRequest
): Promise<DocxGenerateResult> {
  const entry = registry[input.templateId];
  if (!entry) {
    throw new Error('unknown_template');
  }

  if (input.entityType !== entry.entityType) {
    throw new Error(
      `invalid_entity_type:${safeText(input.templateId)}:${safeText(entry.entityType)}`
    );
  }

  return entry.generate(input);
}

export async function computeDocxSourceHash(
  input: Omit<DocxGenerateRequest, 'requestId' | 'onProgress'>
): Promise<string> {
  const entry = registry[input.templateId];
  if (!entry) {
    throw new Error('unknown_template');
  }

  if (input.entityType !== entry.entityType) {
    throw new Error(
      `invalid_entity_type:${safeText(input.templateId)}:${safeText(entry.entityType)}`
    );
  }

  const templateFingerprint = await computeTemplateFingerprint(input.templateId);

  if (input.templateId === 'usecase-onepage') {
    const source = await loadUseCaseOnePageSource(input);
    return hashDocxSnapshot({
      templateId: input.templateId,
      templateFingerprint,
      entityType: input.entityType,
      entityId: input.entityId,
      locale: input.locale ?? 'fr',
      provided: input.provided ?? {},
      controls: input.controls ?? {},
      source,
    });
  }

  if (input.templateId === 'executive-synthesis-multipage') {
    const source = await loadExecutiveSynthesisSource(input);
    return hashDocxSnapshot({
      templateId: input.templateId,
      templateFingerprint,
      entityType: input.entityType,
      entityId: input.entityId,
      locale: input.locale ?? 'fr',
      provided: input.provided ?? {},
      controls: input.controls ?? {},
      source,
    });
  }

  throw new Error('unknown_template');
}
