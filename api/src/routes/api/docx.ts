/**
 * DOCX export routes.
 *
 * Legacy:
 * - GET /use-cases/:id/docx
 *
 * Unified endpoint:
 * - POST /docx/generate
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { folders, useCases } from '../../db/schema';
import { hydrateUseCase, hydrateUseCases } from './use-cases';
import {
  type DocxEntityType,
  type DocxTemplateId,
  type ExecutiveSynthesisDocxInput,
  generateExecutiveSynthesisDocx,
  generateUseCaseDocx,
} from '../../services/docx-service';
import { parseMatrixConfig } from '../../utils/matrix';

type DocxGenerateInput = {
  templateId: DocxTemplateId;
  entityType: DocxEntityType;
  entityId: string;
  provided: Record<string, unknown>;
  controls: Record<string, unknown>;
};

type DocxGenerateResult = {
  fileName: string;
  buffer: Buffer;
};

type RegistryEntry = {
  entityType: DocxEntityType;
  generate: (input: DocxGenerateInput & { workspaceId: string }) => Promise<DocxGenerateResult>;
};

const generateDocxSchema = z.object({
  templateId: z.enum(['usecase-onepage', 'executive-synthesis-multipage']),
  entityType: z.enum(['usecase', 'folder']),
  entityId: z.string().min(1),
  provided: z.record(z.unknown()).optional(),
  controls: z.record(z.unknown()).optional(),
  // Backward-compatible alias (to be removed after migration)
  options: z.record(z.unknown()).optional(),
});

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

function parseExecutiveSummary(value: string | null): ExecutiveSynthesisDocxInput['executiveSummary'] {
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
          .filter((reference): reference is { title: string; url: string; excerpt: string } => reference != null)
      : [];

    return {
      introduction: typeof parsed.introduction === 'string' ? parsed.introduction : '',
      analyse: typeof parsed.analyse === 'string' ? parsed.analyse : '',
      recommandation: typeof parsed.recommandation === 'string' ? parsed.recommandation : '',
      synthese_executive: typeof parsed.synthese_executive === 'string' ? parsed.synthese_executive : '',
      references,
    };
  } catch {
    return {};
  }
}

async function generateUseCaseOnePage(input: DocxGenerateInput & { workspaceId: string }): Promise<DocxGenerateResult> {
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

  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  const buffer = await generateUseCaseDocx(hydrated, matrix);
  const nameSlug = slugify(hydrated.data.name) || 'usecase';

  return {
    buffer,
    fileName: `usecase-${hydrated.id}-${nameSlug}.docx`,
  };
}

async function generateExecutiveSynthesis(input: DocxGenerateInput & { workspaceId: string }): Promise<DocxGenerateResult> {
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

  const buffer = await generateExecutiveSynthesisDocx({
    folderName: folder.name,
    executiveSummary: parseExecutiveSummary(folder.executiveSummary ?? null),
    useCases: hydratedUseCases,
    matrix,
    provided: input.provided,
    controls: input.controls,
  });

  const folderSlug = slugify(folder.name) || 'folder';
  return {
    buffer,
    fileName: `executive-synthesis-${folder.id}-${folderSlug}.docx`,
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

export const docxRouter = new Hono();

docxRouter.get('/use-cases/:id/docx', async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const templateId: DocxTemplateId = 'usecase-onepage';
  const entry = registry[templateId];

  try {
    const result = await entry.generate({
      templateId,
      entityType: 'usecase',
      entityId: c.req.param('id'),
      workspaceId: user.workspaceId,
      provided: {},
      controls: {},
    });

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    c.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'not_found') {
      return c.json({ message: 'Not found' }, 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ message: 'Failed to generate DOCX document.', error: message }, 422);
  }
});

docxRouter.post('/docx/generate', zValidator('json', generateDocxSchema), async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const entry = registry[payload.templateId];

  if (!entry) {
    return c.json({ message: 'Unknown templateId' }, 400);
  }

  if (payload.entityType !== entry.entityType) {
    return c.json(
      {
        message: `Invalid entityType for templateId ${payload.templateId}. Expected ${entry.entityType}.`,
      },
      400
    );
  }

  try {
    const result = await entry.generate({
      templateId: payload.templateId,
      entityType: payload.entityType,
      entityId: payload.entityId,
      workspaceId: user.workspaceId,
      provided: payload.provided ?? payload.options ?? {},
      controls: payload.controls ?? {},
    });

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    c.header('Content-Disposition', `attachment; filename="${result.fileName}"`);
    return c.body(new Uint8Array(result.buffer));
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'not_found') {
      return c.json({ message: 'Not found' }, 404);
    }
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ message: 'Failed to generate DOCX document.', error: message }, 422);
  }
});
