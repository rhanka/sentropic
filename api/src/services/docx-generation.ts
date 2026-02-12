import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { folders, useCases } from '../db/schema';
import { hydrateUseCase, hydrateUseCases } from '../routes/api/use-cases';
import type { MatrixConfig } from '../types/matrix';
import type { UseCase } from '../types/usecase';
import {
  type DocxEntityType,
  type DocxTemplateId,
  generateExecutiveSynthesisDocx,
  generateUseCaseDocx,
} from './docx-service';
import { parseMatrixConfig } from '../utils/matrix';

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

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function safeText(value: unknown): string {
  if (value == null) return '';
  return String(value);
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

  if (input.templateId === 'usecase-onepage') {
    const source = await loadUseCaseOnePageSource(input);
    return hashDocxSnapshot({
      templateId: input.templateId,
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
