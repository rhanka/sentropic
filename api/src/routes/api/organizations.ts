import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db, pool } from '../../db/client';
import { folders, organizations, useCases } from '../../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { enrichOrganization } from '../../services/context-organization';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';
import { isObjectLockedError, requireLockOwnershipForMutation } from '../../services/lock-service';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';

type OrganizationData = {
  industry?: string;
  size?: string;
  products?: string;
  processes?: string;
  kpis?: string;
  challenges?: string;
  objectives?: string;
  technologies?: string;
  references?: Array<{ title: string; url: string; excerpt?: string }>;
};

function coerceMarkdownField(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value
      .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return undefined;
    return items.map((s) => `- ${s}`).join('\n');
  }
  return undefined;
}

function coerceKpisString(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const items = value
      .map((v) => (typeof v === 'string' ? v : v == null ? '' : String(v)))
      .map((s) => s.trim())
      .filter(Boolean);
    if (items.length === 0) return undefined;
    return items.map((s) => `- ${s}`).join('\n');
  }
  return undefined;
}

function coerceReferences(value: unknown): Array<{ title: string; url: string; excerpt?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => !!v)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : String(r.title ?? ''),
      url: typeof r.url === 'string' ? r.url : String(r.url ?? ''),
      excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined,
    }))
    .filter((r) => r.title.trim() && r.url.trim());
}

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
  const raw = data as unknown as Record<string, unknown>;
  const rawStatus = row.status;
  const status =
    rawStatus === 'draft' || rawStatus === 'enriching' || rawStatus === 'completed' ? rawStatus : null;

  // KPI legacy: accepte kpis (string) ou anciens kpis_sector/kpis_org (arrays)
  const legacyKpisCombined = (() => {
    const sector = coerceKpisString(raw.kpis_sector);
    const org = coerceKpisString(raw.kpis_org);
    const parts = [sector, org].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (parts.length === 0) return undefined;
    return parts.join('\n\n');
  })();

  return {
    id: row.id,
    name: row.name,
    status,
    industry: data.industry,
    size: data.size,
    // Tolère les anciennes écritures en arrays (ex: via chat) et normalise vers markdown string
    products: coerceMarkdownField(raw.products) ?? data.products,
    processes: coerceMarkdownField(raw.processes) ?? data.processes,
    kpis: coerceKpisString(raw.kpis ?? data.kpis) ?? legacyKpisCombined,
    challenges: coerceMarkdownField(raw.challenges) ?? data.challenges,
    objectives: coerceMarkdownField(raw.objectives) ?? data.objectives,
    technologies: coerceMarkdownField(raw.technologies) ?? data.technologies,
    references: coerceReferences(raw.references ?? data.references),
  };
}

const organizationInput = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  size: z.string().optional(),
  products: z.string().optional(),
  processes: z.string().optional(),
  kpis: z.string().optional(),
  challenges: z.string().optional(),
  objectives: z.string().optional(),
  technologies: z.string().optional(),
  status: z.enum(['draft', 'enriching', 'completed']).default('completed'),
});

export const organizationsRouter = new Hono();

async function notifyOrganizationEvent(organizationId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ organization_id: organizationId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY organization_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

organizationsRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const rows = await db
    .select()
    .from(organizations)
    .where(eq(organizations.workspaceId, targetWorkspaceId));
  return c.json({ items: rows.map(hydrateOrganization) });
});

organizationsRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', organizationInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };
  const payload = c.req.valid('json');
  const id = createId();

  const data: OrganizationData = {
    industry: payload.industry,
    size: payload.size,
    products: payload.products,
    processes: payload.processes,
    kpis: payload.kpis,
    challenges: payload.challenges,
    objectives: payload.objectives,
    technologies: payload.technologies,
    references: [],
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
      data: { references: [] } satisfies OrganizationData,
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

  const jobId = await queueManager.addJob(
    'organization_enrich',
    {
      organizationId: id,
      organizationName: org.name,
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
  const targetWorkspaceId = user.workspaceId;
  const id = c.req.param('id');
  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, targetWorkspaceId)));
  if (!org) return c.json({ message: 'Not found' }, 404);
  return c.json(hydrateOrganization(org));
});

organizationsRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', organizationInput.partial()), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');
  const payload = c.req.valid('json');

  const [existing] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  if (!existing) return c.json({ message: 'Not found' }, 404);

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'organization',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }

  const currentData = parseOrganizationData(existing.data);
  const nextData: OrganizationData = {
    ...currentData,
    ...(payload.industry !== undefined ? { industry: payload.industry } : {}),
    ...(payload.size !== undefined ? { size: payload.size } : {}),
    ...(payload.products !== undefined ? { products: payload.products } : {}),
    ...(payload.processes !== undefined ? { processes: payload.processes } : {}),
    ...(payload.kpis !== undefined ? { kpis: payload.kpis } : {}),
    ...(payload.challenges !== undefined ? { challenges: payload.challenges } : {}),
    ...(payload.objectives !== undefined ? { objectives: payload.objectives } : {}),
    ...(payload.technologies !== undefined ? { technologies: payload.technologies } : {}),
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

organizationsRouter.post('/ai-enrich', requireEditor, requireWorkspaceEditorRole(), zValidator('json', aiEnrichInput), async (c) => {
  const { name, model } = c.req.valid('json');
  const selectedModel = model || 'gpt-4.1-nano';
  const enrichedData = await enrichOrganization(name, selectedModel, undefined, undefined, {
    organizationId: undefined,
    workspaceId: undefined,
    existingData: {},
    useDocuments: false
  });
  return c.json(enrichedData);
});

organizationsRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id');

  const [org] = await db
    .select()
    .from(organizations)
    .where(and(eq(organizations.id, id), eq(organizations.workspaceId, workspaceId)));
  if (!org) return c.json({ message: 'Not found' }, 404);

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'organization',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }

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


