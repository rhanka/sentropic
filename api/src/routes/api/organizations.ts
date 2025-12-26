import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db, pool } from '../../db/client';
import { folders, organizations, useCases } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { enrichCompany as enrichOrganization } from '../../services/context-company';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';
import { requireEditor } from '../../middleware/rbac';
import { resolveReadableWorkspaceId } from '../../utils/workspace-scope';

type OrganizationData = {
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
  kpis_sector?: string[];
  kpis_org?: string[];
};

function parseOrganizationData(value: unknown): OrganizationData {
  if (!value) return {};
  if (typeof value === 'object') return value as OrganizationData;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as OrganizationData;
    } catch {
      return {};
    }
  }
  return {};
}

function hydrateOrganization(row: typeof organizations.$inferSelect): {
  id: string;
  name: string;
  status: 'draft' | 'enriching' | 'completed' | null;
} & OrganizationData {
  const data = parseOrganizationData(row.data);
  const rawStatus = row.status;
  const status =
    rawStatus === 'draft' || rawStatus === 'enriching' || rawStatus === 'completed' ? rawStatus : null;
  return {
    id: row.id,
    name: row.name,
    status,
    industry: data.industry,
    size: data.size,
    products: data.products,
    processes: data.processes,
    challenges: data.challenges,
    objectives: data.objectives,
    technologies: data.technologies,
    kpis_sector: Array.isArray(data.kpis_sector) ? data.kpis_sector : [],
    kpis_org: Array.isArray(data.kpis_org) ? data.kpis_org : [],
  };
}

const organizationInput = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  size: z.string().optional(),
  products: z.string().optional(),
  processes: z.string().optional(),
  challenges: z.string().optional(),
  objectives: z.string().optional(),
  technologies: z.string().optional(),
  kpis_sector: z.array(z.string()).optional(),
  kpis_org: z.array(z.string()).optional(),
  status: z.enum(['draft', 'enriching', 'completed']).default('completed'),
});

export const organizationsRouter = new Hono();

async function notifyOrganizationEvent(organizationId: string): Promise<void> {
  // Backward-compatible channel name (UI listens to company_events today).
  const notifyPayload = JSON.stringify({ company_id: organizationId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY company_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

organizationsRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  let targetWorkspaceId = user.workspaceId;
  try {
    targetWorkspaceId = await resolveReadableWorkspaceId({
      user,
      requested: c.req.query('workspace_id'),
    });
  } catch {
    return c.json({ message: 'Not found' }, 404);
  }
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.workspaceId, targetWorkspaceId));
  return c.json({ items: rows.map(hydrateOrganization) });
});

organizationsRouter.post('/', requireEditor, zValidator('json', organizationInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const id = createId();

  const data: OrganizationData = {
    industry: payload.industry,
    size: payload.size,
    products: payload.products,
    processes: payload.processes,
    challenges: payload.challenges,
    objectives: payload.objectives,
    technologies: payload.technologies,
    kpis_sector: payload.kpis_sector ?? [],
    kpis_org: payload.kpis_org ?? [],
  };

  await db.insert(organizations).values({
    id,
    workspaceId,
    name: payload.name,
    status: payload.status,
    data,
  });

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  await notifyOrganizationEvent(id);
  return c.json(hydrateOrganization(org), 201);
});

// POST /api/v1/organizations/draft - Create an organization as draft
organizationsRouter.post(
  '/draft',
  requireEditor,
  zValidator(
    'json',
    z.object({
      name: z.string().min(1),
    })
  ),
  async (c) => {
    const { workspaceId } = c.get('user') as { workspaceId: string };
    const { name } = c.req.valid('json');
    const id = createId();

    await db.insert(organizations).values({
      id,
      workspaceId,
      name,
      status: 'draft',
      data: { kpis_sector: [], kpis_org: [] } satisfies OrganizationData,
    });

    const [org] = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
    await notifyOrganizationEvent(id);
    return c.json(hydrateOrganization(org), 201);
  }
);

// POST /api/v1/organizations/:id/enrich - Start enrichment (async via queue)
organizationsRouter.post('/:id/enrich', requireEditor, async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const { model } = await c.req.json().catch(() => ({}));

  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  if (!org) return c.json({ message: 'Not found' }, 404);

  await db
    .update(organizations)
    .set({ status: 'enriching' })
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  await notifyOrganizationEvent(id);

  // Keep existing queue job type for now (will be renamed later if needed).
  const jobId = await queueManager.addJob(
    'company_enrich',
    {
      companyId: id,
      companyName: org.name,
      model: selectedModel,
    },
    { workspaceId }
  );

  return c.json({
    success: true,
    message: 'Enrichment started',
    status: 'enriching',
    jobId,
  });
});

organizationsRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  let targetWorkspaceId = user.workspaceId;
  try {
    targetWorkspaceId = await resolveReadableWorkspaceId({
      user,
      requested: c.req.query('workspace_id'),
    });
  } catch {
    return c.json({ message: 'Not found' }, 404);
  }
  const id = c.req.param('id');
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, targetWorkspaceId)));
  if (!org) return c.json({ message: 'Not found' }, 404);
  return c.json(hydrateOrganization(org));
});

organizationsRouter.put('/:id', requireEditor, zValidator('json', organizationInput.partial()), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  if (!existing) return c.json({ message: 'Not found' }, 404);

  const currentData = parseOrganizationData(existing.data);
  const nextData: OrganizationData = {
    ...currentData,
    ...(payload.industry !== undefined ? { industry: payload.industry } : {}),
    ...(payload.size !== undefined ? { size: payload.size } : {}),
    ...(payload.products !== undefined ? { products: payload.products } : {}),
    ...(payload.processes !== undefined ? { processes: payload.processes } : {}),
    ...(payload.challenges !== undefined ? { challenges: payload.challenges } : {}),
    ...(payload.objectives !== undefined ? { objectives: payload.objectives } : {}),
    ...(payload.technologies !== undefined ? { technologies: payload.technologies } : {}),
    ...(payload.kpis_sector !== undefined ? { kpis_sector: payload.kpis_sector } : {}),
    ...(payload.kpis_org !== undefined ? { kpis_org: payload.kpis_org } : {}),
  };

  const updated = await db
    .update(organizations)
    .set({
      ...(payload.name !== undefined ? { name: payload.name } : {}),
      ...(payload.status !== undefined ? { status: payload.status } : {}),
      data: nextData,
      updatedAt: new Date(),
    })
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)))
    .returning();

  await notifyOrganizationEvent(id);
  return c.json(hydrateOrganization(updated[0]));
});

// POST /api/v1/organizations/ai-enrich - synchronous enrichment (compat)
const aiEnrichInput = z.object({
  name: z.string().min(1),
  model: z.string().optional(),
});

organizationsRouter.post('/ai-enrich', requireEditor, zValidator('json', aiEnrichInput), async (c) => {
  const { name, model } = c.req.valid('json');
  const selectedModel = model || 'gpt-4.1-nano';
  const enrichedData = await enrichOrganization(name, selectedModel);
  return c.json(enrichedData);
});

organizationsRouter.delete('/:id', requireEditor, async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const id = c.req.param('id');

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  if (!org) return c.json({ message: 'Not found' }, 404);

  // Check dependencies
  const relatedFolders = await db
    .select()
    .from(folders)
    .where(and(eq(folders.organizationId, id), eq(folders.workspaceId, workspaceId)));
  const relatedUseCases = await db
    .select()
    .from(useCases)
    .where(and(eq(useCases.organizationId, id), eq(useCases.workspaceId, workspaceId)));

  if (relatedFolders.length > 0 || relatedUseCases.length > 0) {
    return c.json(
      {
        message: 'Cannot delete organization because it is in use',
        details: { folders: relatedFolders.length, useCases: relatedUseCases.length },
      },
      409
    );
  }

  await db.delete(organizations).where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  await notifyOrganizationEvent(id);
  return c.body(null, 204);
});


