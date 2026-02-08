/**
 * DOCX export routes.
 *
 * GET /use-cases/:id/docx — generate and download a one-page DOCX for a use case.
 */

import { Hono } from 'hono';
import { db } from '../../db/client';
import { useCases } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { hydrateUseCase } from './use-cases';
import { generateUseCaseDocx } from '../../services/docx-service';
import { folders } from '../../db/schema';
import { parseMatrixConfig } from '../../utils/matrix';

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

export const docxRouter = new Hono();

docxRouter.get('/use-cases/:id/docx', async (c) => {
  const user = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');

  const [record] = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.id, id), eq(useCases.workspaceId, user.workspaceId)));

  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }

  const hydrated = await hydrateUseCase(record);
  const [folder] = await db
    .select({ matrixConfig: folders.matrixConfig })
    .from(folders)
    .where(and(eq(folders.id, hydrated.folderId), eq(folders.workspaceId, user.workspaceId)));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  try {
    const buf = await generateUseCaseDocx(hydrated, matrix);

    const nameSlug = slugify(hydrated.data.name) || 'usecase';
    const fileName = `usecase-${id}-${nameSlug}.docx`;

    c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    c.header('Content-Disposition', `attachment; filename="${fileName}"`);
    return c.body(new Uint8Array(buf));
  } catch (error: any) {
    const message = String(error?.message ?? error);
    return c.json({ message: 'Invalid DOCX template.', error: message }, 422);
  }
});
