import vm from 'node:vm';
import { and, asc, eq } from 'drizzle-orm';
import pptxgenjs from 'pptxgenjs';
import { db } from '../db/client';
import { folders, initiatives } from '../db/schema';
import type { MatrixConfig } from '../types/matrix';
import type { Initiative, InitiativeData, ScoreEntry } from '../types/initiative';
import { parseMatrixConfig } from '../utils/matrix';
import { calculateInitiativeScores } from '../utils/scoring';
import {
  getSandboxGlobals,
  type PptxFreeformContext,
  type PptxPresentation,
} from './pptx-freeform-helpers';

export type PptxEntityType = 'initiative' | 'folder';

export type FreeformPptxRequest = {
  code: string;
  entityType: PptxEntityType;
  entityId: string;
  workspaceId: string;
  title?: string;
};

export type PptxGenerateResult = {
  fileName: string;
  buffer: Buffer;
  mimeType: string;
};

export type FreeformPptxExecutionResult = {
  presentation: PptxPresentation;
  fileName?: string;
};

type SerializedInitiative = typeof initiatives.$inferSelect;

type LegacyInitiativeRow = SerializedInitiative & {
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

export const PPTX_MIME =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const MAX_FILENAME_BASE_LENGTH = 120;

function codedError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

const parseJson = <T>(value: string | null | undefined): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
};

function extractInitiativeData(row: SerializedInitiative): Partial<InitiativeData> {
  let data: Partial<InitiativeData> = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as Partial<InitiativeData>;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as Partial<InitiativeData>;
    }
  } catch {
    data = {};
  }

  const legacyRow = row as LegacyInitiativeRow;
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
  if (!data.name) data.name = 'Untitled initiative';

  return data;
}

async function hydrateInitiative(row: SerializedInitiative): Promise<Initiative> {
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, row.folderId), eq(folders.workspaceId, row.workspaceId)));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  const data = extractInitiativeData(row);
  const computedScores = calculateInitiativeScores(matrix, data as InitiativeData);

  return {
    id: row.id,
    folderId: row.folderId,
    organizationId: row.organizationId,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt,
    data: data as InitiativeData,
    totalValueScore: computedScores?.totalValueScore ?? null,
    totalComplexityScore: computedScores?.totalComplexityScore ?? null,
  };
}

async function hydrateInitiatives(rows: SerializedInitiative[]): Promise<Initiative[]> {
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
    const data = extractInitiativeData(row);
    const computedScores = calculateInitiativeScores(matrix, data as InitiativeData);

    return {
      id: row.id,
      folderId: row.folderId,
      organizationId: row.organizationId,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data: data as InitiativeData,
      totalValueScore: computedScores?.totalValueScore ?? null,
      totalComplexityScore: computedScores?.totalComplexityScore ?? null,
    } satisfies Initiative;
  });
}

function parseExecutiveSummary(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function loadFreeformContext(
  entityType: PptxEntityType,
  entityId: string,
  workspaceId: string,
): Promise<PptxFreeformContext> {
  if (entityType === 'initiative') {
    const [record] = await db
      .select()
      .from(initiatives)
      .where(and(eq(initiatives.id, entityId), eq(initiatives.workspaceId, workspaceId)));
    if (!record) throw codedError('not_found', 'Initiative not found');
    const hydrated = await hydrateInitiative(record);
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, hydrated.folderId), eq(folders.workspaceId, workspaceId)));
    return {
      entity: hydrated as unknown as Record<string, unknown>,
      initiatives: [],
      matrix: parseMatrixConfig(folder?.matrixConfig ?? null) as unknown as MatrixConfig,
      workspace: { id: workspaceId },
    };
  }

  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, entityId), eq(folders.workspaceId, workspaceId)));
  if (!folder) throw codedError('not_found', 'Folder not found');

  const rows = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.folderId, entityId), eq(initiatives.workspaceId, workspaceId)))
    .orderBy(asc(initiatives.createdAt));
  const hydratedInitiatives = await hydrateInitiatives(rows);
  const matrix = parseMatrixConfig(folder.matrixConfig ?? null);

  return {
    entity: {
      id: folder.id,
      name: folder.name,
      description: folder.description,
      executiveSummary: parseExecutiveSummary(folder.executiveSummary ?? null),
    },
    initiatives: hydratedInitiatives as unknown as Record<string, unknown>[],
    matrix: matrix as unknown as Record<string, unknown> | null,
    workspace: { id: workspaceId },
  };
}

export function isPptxPresentation(value: unknown): value is PptxPresentation {
  return (
    value instanceof pptxgenjs &&
    typeof (value as { addSlide?: unknown }).addSlide === 'function' &&
    typeof (value as { write?: unknown }).write === 'function'
  );
}

function normalizeExecutionResult(result: unknown): FreeformPptxExecutionResult {
  if (isPptxPresentation(result)) return { presentation: result };
  if (result && typeof result === 'object') {
    const record = result as { presentation?: unknown; fileName?: unknown };
    if (isPptxPresentation(record.presentation)) {
      return {
        presentation: record.presentation,
        fileName: typeof record.fileName === 'string' ? record.fileName : undefined,
      };
    }
  }
  throw codedError(
    'invalid_return_type',
    'Code must return a PptGenJS presentation object or { presentation, fileName? }',
  );
}

export function executeFreeformPptxCode(
  code: string,
  contextData: PptxFreeformContext,
): FreeformPptxExecutionResult {
  const globals = getSandboxGlobals(contextData);
  const sandbox = vm.createContext(globals);

  try {
    const wrappedCode = `(function() { ${code} })()`;
    const script = new vm.Script(wrappedCode, { filename: 'freeform-pptx.js' });
    const result = script.runInContext(sandbox, { timeout: 30_000 });
    return normalizeExecutionResult(result);
  } catch (error: unknown) {
    const existingCode = (error as { code?: unknown } | null)?.code;
    if (typeof existingCode === 'string') throw error;
    if (error instanceof SyntaxError) {
      throw codedError('code_syntax_error', error.message || 'Syntax error in freeform PPTX code');
    }
    if (error instanceof Error && error.message.includes('Script execution timed out')) {
      throw codedError('code_timeout', 'Script execution exceeded 30s limit');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw codedError('code_runtime_error', message);
  }
}

function normalizePptxFileName(value: string): string {
  const base = value
    .replace(/\.pptx$/i, '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILENAME_BASE_LENGTH);
  return `${base || 'presentation'}.pptx`;
}

async function toBuffer(output: string | ArrayBuffer | Blob | Uint8Array): Promise<Buffer> {
  if (Buffer.isBuffer(output)) return output;
  if (output instanceof Uint8Array) return Buffer.from(output);
  if (output instanceof ArrayBuffer) return Buffer.from(output);
  if (typeof Blob !== 'undefined' && output instanceof Blob) {
    return Buffer.from(await output.arrayBuffer());
  }
  if (typeof output === 'string') return Buffer.from(output, 'binary');
  throw codedError('pptx_packaging_error', 'Unsupported PptGenJS output type');
}

export async function writePptxBuffer(presentation: PptxPresentation): Promise<Buffer> {
  try {
    const output = await presentation.write({ outputType: 'nodebuffer' });
    return await toBuffer(output);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw codedError('pptx_packaging_error', message);
  }
}

export async function generateFreeformPptx(
  request: FreeformPptxRequest,
): Promise<PptxGenerateResult> {
  const { code, entityType, entityId, workspaceId } = request;
  const contextData = await loadFreeformContext(entityType, entityId, workspaceId);
  const executionResult = executeFreeformPptxCode(code, contextData);
  const buffer = await writePptxBuffer(executionResult.presentation);
  const requestedName =
    executionResult.fileName ?? request.title ?? `freeform-${entityType}-${entityId.slice(0, 8)}`;

  return {
    buffer,
    mimeType: PPTX_MIME,
    fileName: normalizePptxFileName(requestedName),
  };
}
