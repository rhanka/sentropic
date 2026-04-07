
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db, pool } from '../../db/client';
import { organizations, folders, initiatives } from '../../db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { parseMatrixConfig } from '../../utils/matrix';
import { calculateInitiativeScores, type ScoreEntry } from '../../utils/scoring';
import type { InitiativeData, Initiative, InitiativeDataJson } from '../../types/initiative';
import { defaultMatrixConfig } from '../../config/default-matrix';
// default-prompts removed (BR-04); prompts now in split agent files + default-chat-system
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';
import { todoOrchestrationService, type MatrixSource } from '../../services/todo-orchestration';
import { requireEditor } from '../../middleware/rbac';
import { requireWorkspaceEditorRole } from '../../middleware/workspace-rbac';
import { isObjectLockedError, requireLockOwnershipForMutation } from '../../services/lock-service';
import { resolveLocaleFromHeaders } from '../../utils/locale';
import { isNeutralWorkspace } from '../../services/workspace-access';
import { evaluateGate } from '../../services/gate-service';

async function notifyInitiativeEvent(initiativeId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ initiative_id: initiativeId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY initiative_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

async function notifyFolderEvent(folderId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ folder_id: folderId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

// folder_name prompt now in ORGANIZATION_PROMPTS (default-chat-system.ts) - currently unused

const scoreEntry = z.object({
  axisId: z.string(),
  rating: z.number().min(0).max(100),
  description: z.string()
});

const initiativeInput = z.object({
  folderId: z.string(),
  organizationId: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(), // 30-60 caractères
  // Nouveaux champs pour data JSONB
  problem: z.string().optional(), // 40-80 caractères
  solution: z.string().optional(), // 40-80 caractères
  // Champs métier (seront dans data JSONB)
  process: z.string().optional(),
  domain: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  deadline: z.string().optional(),
  contact: z.string().optional(),
  benefits: z.array(z.string()).optional(),
  metrics: z.array(z.string()).optional(),
  risks: z.array(z.string()).optional(),
  constraints: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  dataSources: z.array(z.string()).optional(),
  dataObjects: z.array(z.string()).optional(),
  references: z.array(z.object({
    title: z.string(),
    url: z.string(),
    excerpt: z.string().optional(),
  })).optional(),
  valueScores: z.array(scoreEntry).optional(),
  complexityScores: z.array(scoreEntry).optional()
});

type InitiativeInput = z.infer<typeof initiativeInput>;

export type SerializedInitiative = typeof initiatives.$inferSelect;

type MatrixMode = 'organization' | 'generate' | 'default';

// Type pour rétrocompatibilité avec les anciennes colonnes (avant migration 0008)
// Permet l'accès aux propriétés qui peuvent encore exister dans certains backups
type LegacyInitiativeRow = SerializedInitiative & {
  name?: string;
  description?: string;
  process?: string;
  domain?: string;
  technologies?: string | null;
  prerequisites?: string;
  deadline?: string;
  contact?: string;
  benefits?: string | null;
  metrics?: string | null;
  risks?: string | null;
  nextSteps?: string | null;
  dataSources?: string | null;
  dataObjects?: string | null;
  references?: string | null;
  valueScores?: string | null;
  complexityScores?: string | null;
};

const parseJson = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    return undefined;
  }
};

function parseOrganizationData(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function parseOrganizationMatrixTemplate(value: unknown): Record<string, unknown> | null {
  const data = parseOrganizationData(value);
  const candidate = data.matrixTemplate;
  if (!candidate || typeof candidate !== 'object') return null;
  return candidate as Record<string, unknown>;
}

/**
 * Extrait les données de data JSONB et des colonnes temporaires (rétrocompatibilité)
 * Calcule les scores dynamiquement à partir de la matrice du dossier
 */
export const hydrateInitiative = async (row: SerializedInitiative): Promise<Initiative> => {
  // Récupérer la matrice du dossier pour calculer les scores
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, row.folderId), eq(folders.workspaceId, row.workspaceId)));
  const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
  
  // Extraire data JSONB (peut être vide {} pour les anciens enregistrements)
  let data: Partial<InitiativeData> = {};
  try {
    if (row.data && typeof row.data === 'object') {
      data = row.data as Partial<InitiativeData>;
    } else if (typeof row.data === 'string') {
      data = JSON.parse(row.data) as Partial<InitiativeData>;
    }
  } catch (error) {
    // Si data n'est pas valide, on part d'un objet vide
    data = {};
  }
  
  // Rétrocompatibilité : migrer depuis les colonnes natives si elles existent encore dans la DB
  // (pour les backups de prod qui ont encore ces colonnes avant application de la migration 0008)
  // Note: Après la migration 0008, toutes les colonnes sont supprimées et toutes les données sont dans data
  const legacyRow = row as LegacyInitiativeRow;
  if (!data.name && legacyRow.name) {
    data.name = legacyRow.name;
  }
  if (!data.description && legacyRow.description) {
    data.description = legacyRow.description;
  }
  if (!data.process && legacyRow.process) {
    data.process = legacyRow.process;
  }
  if (!data.domain && legacyRow.domain) {
    data.domain = legacyRow.domain;
  }
  if (!data.technologies && legacyRow.technologies) {
    data.technologies = parseJson<string[]>(legacyRow.technologies) ?? [];
  }
  if (!data.prerequisites && legacyRow.prerequisites) {
    data.prerequisites = legacyRow.prerequisites;
  }
  if (!data.deadline && legacyRow.deadline) {
    data.deadline = legacyRow.deadline;
  }
  if (!data.contact && legacyRow.contact) {
    data.contact = legacyRow.contact;
  }
  if (!data.benefits && legacyRow.benefits) {
    data.benefits = parseJson<string[]>(legacyRow.benefits) ?? [];
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
    data.references = parseJson<Array<{ title: string; url: string; excerpt?: string }>>(legacyRow.references) ?? [];
  }
  if (!data.valueScores && legacyRow.valueScores) {
    data.valueScores = parseJson<ScoreEntry[]>(legacyRow.valueScores) ?? [];
  }
  if (!data.complexityScores && legacyRow.complexityScores) {
    data.complexityScores = parseJson<ScoreEntry[]>(legacyRow.complexityScores) ?? [];
  }
  
  // S'assurer que name est présent (obligatoire)
  if (!data.name) {
    data.name = 'Cas d\'usage sans nom';
  }
  
  const [organization] = row.organizationId
    ? await db
        .select({ name: organizations.name })
        .from(organizations)
        .where(and(eq(organizations.id, row.organizationId), eq(organizations.workspaceId, row.workspaceId)))
        .limit(1)
    : [];

  // Calculer les scores dynamiquement
  const computedScores = calculateInitiativeScores(matrix, data as InitiativeData);
  
  return {
    id: row.id,
    folderId: row.folderId,
    organizationId: row.organizationId,
    organizationName: organization?.name ?? null,
    status: row.status ?? 'completed',
    model: row.model,
    createdAt: row.createdAt,
    data: data as InitiativeData,
    totalValueScore: computedScores?.totalValueScore ?? null,
    totalComplexityScore: computedScores?.totalComplexityScore ?? null
  };
};

/**
 * Hydrate plusieurs use cases en une fois (optimisé pour les listes)
 */
export const hydrateInitiatives = async (rows: SerializedInitiative[]): Promise<Initiative[]> => {
  const workspaceId = rows[0]?.workspaceId;
  // Récupérer tous les dossiers uniques pour éviter les requêtes multiples
  const folderIds = [...new Set(rows.map(r => r.folderId))];
  const foldersMap = new Map<string, typeof folders.$inferSelect>();
  
  for (const folderId of folderIds) {
    const [folder] = workspaceId
      ? await db.select().from(folders).where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
      : await db.select().from(folders).where(eq(folders.id, folderId));
    if (folder) {
      foldersMap.set(folderId, folder);
    }
  }

  const organizationIds = [...new Set(
    rows
      .map((row) => row.organizationId)
      .filter((organizationId): organizationId is string => typeof organizationId === 'string' && organizationId.length > 0)
  )];
  const organizationNames = new Map<string, string>();
  if (workspaceId && organizationIds.length > 0) {
    const organizationRows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(eq(organizations.workspaceId, workspaceId), inArray(organizations.id, organizationIds)));
    for (const organization of organizationRows) {
      organizationNames.set(organization.id, organization.name);
    }
  }
  
  return Promise.all(rows.map(async (row) => {
    const folder = foldersMap.get(row.folderId);
    const matrix = parseMatrixConfig(folder?.matrixConfig ?? null);
    
    // Extraire data JSONB
    let data: Partial<InitiativeData> = {};
    try {
      if (row.data && typeof row.data === 'object') {
        data = row.data as Partial<InitiativeData>;
      } else if (typeof row.data === 'string') {
        data = JSON.parse(row.data) as Partial<InitiativeData>;
      }
    } catch (error) {
      data = {};
    }
    
    // Rétrocompatibilité : migrer depuis les colonnes natives si elles existent encore dans la DB
    // (pour les backups de prod qui ont encore ces colonnes avant application de la migration 0008)
    const legacyRow = row as LegacyInitiativeRow;
    if (!data.name && legacyRow.name) {
      data.name = legacyRow.name;
    }
    if (!data.description && legacyRow.description) {
      data.description = legacyRow.description;
    }
    if (!data.process && legacyRow.process) data.process = legacyRow.process;
    if (!data.domain && legacyRow.domain) data.domain = legacyRow.domain;
    if (!data.technologies && legacyRow.technologies) data.technologies = parseJson<string[]>(legacyRow.technologies) ?? [];
    if (!data.prerequisites && legacyRow.prerequisites) data.prerequisites = legacyRow.prerequisites;
    if (!data.deadline && legacyRow.deadline) data.deadline = legacyRow.deadline;
    if (!data.contact && legacyRow.contact) data.contact = legacyRow.contact;
    if (!data.benefits && legacyRow.benefits) data.benefits = parseJson<string[]>(legacyRow.benefits) ?? [];
    if (!data.metrics && legacyRow.metrics) data.metrics = parseJson<string[]>(legacyRow.metrics) ?? [];
    if (!data.risks && legacyRow.risks) data.risks = parseJson<string[]>(legacyRow.risks) ?? [];
    if (!data.nextSteps && legacyRow.nextSteps) data.nextSteps = parseJson<string[]>(legacyRow.nextSteps) ?? [];
    if (!data.dataSources && legacyRow.dataSources) data.dataSources = parseJson<string[]>(legacyRow.dataSources) ?? [];
    if (!data.dataObjects && legacyRow.dataObjects) data.dataObjects = parseJson<string[]>(legacyRow.dataObjects) ?? [];
    if (!data.references && legacyRow.references) {
      data.references = parseJson<Array<{ title: string; url: string; excerpt?: string }>>(legacyRow.references) ?? [];
    }
    if (!data.valueScores && legacyRow.valueScores) data.valueScores = parseJson<ScoreEntry[]>(legacyRow.valueScores) ?? [];
    if (!data.complexityScores && legacyRow.complexityScores) data.complexityScores = parseJson<ScoreEntry[]>(legacyRow.complexityScores) ?? [];
    
    // S'assurer que name est présent (obligatoire)
    if (!data.name) {
      data.name = 'Cas d\'usage sans nom';
    }
    
    // Calculer les scores dynamiquement
    const computedScores = calculateInitiativeScores(matrix, data as InitiativeData);
    
    return {
      id: row.id,
      folderId: row.folderId,
      organizationId: row.organizationId,
      organizationName: row.organizationId ? (organizationNames.get(row.organizationId) ?? null) : null,
      status: row.status ?? 'completed',
      model: row.model,
      createdAt: row.createdAt,
      data: data as InitiativeData,
      totalValueScore: computedScores?.totalValueScore ?? null,
      totalComplexityScore: computedScores?.totalComplexityScore ?? null
    };
  }));
};

/**
 * Construit l'objet data JSONB à partir d'un InitiativeInput (peut être partiel pour PUT)
 */
const buildInitiativeData = (payload: Partial<InitiativeInput>, existingData?: Partial<InitiativeData>): InitiativeData => {
  // S'assurer que name est toujours défini (obligatoire)
  const name: string = payload.name ?? existingData?.name ?? 'Cas d\'usage sans nom';
  const data: InitiativeData = existingData 
    ? { ...existingData, name } 
    : { name };
  
  // Champs principaux (obligatoires) - name est déjà défini ci-dessus
  if (payload.description !== undefined) data.description = payload.description;
  
  // Nouveaux champs
  if (payload.problem !== undefined) data.problem = payload.problem;
  if (payload.solution !== undefined) data.solution = payload.solution;
  
  // Champs métier
  if (payload.process !== undefined) data.process = payload.process;
  if (payload.domain !== undefined) data.domain = payload.domain;
  if (payload.technologies !== undefined) data.technologies = payload.technologies;
  if (payload.deadline !== undefined) data.deadline = payload.deadline;
  if (payload.contact !== undefined) data.contact = payload.contact;
  if (payload.benefits !== undefined) data.benefits = payload.benefits;
  if (payload.metrics !== undefined) data.metrics = payload.metrics;
  if (payload.risks !== undefined) data.risks = payload.risks;
  if (payload.constraints !== undefined) data.constraints = payload.constraints;
  if (payload.nextSteps !== undefined) data.nextSteps = payload.nextSteps;
  if (payload.dataSources !== undefined) data.dataSources = payload.dataSources;
  if (payload.dataObjects !== undefined) data.dataObjects = payload.dataObjects;
  if (payload.references !== undefined) data.references = payload.references;
  if (payload.valueScores !== undefined) data.valueScores = payload.valueScores;
  if (payload.complexityScores !== undefined) data.complexityScores = payload.complexityScores;
  
  return data;
};

export const initiativesRouter = new Hono();

initiativesRouter.get('/', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const folderId = c.req.query('folder_id');
  const rows = folderId
    ? await db.select().from(initiatives).where(and(eq(initiatives.workspaceId, targetWorkspaceId), eq(initiatives.folderId, folderId)))
    : await db.select().from(initiatives).where(eq(initiatives.workspaceId, targetWorkspaceId));
  const hydrated = await hydrateInitiatives(rows);
  return c.json({ items: hydrated });
});

initiativesRouter.post('/', requireEditor, requireWorkspaceEditorRole(), zValidator('json', initiativeInput), async (c) => {
  const { workspaceId } = c.get('user') as { workspaceId: string };

  // Neutral workspaces cannot contain initiatives.
  if (await isNeutralWorkspace(workspaceId)) {
    return c.json({ error: 'Neutral workspaces do not support initiatives' }, 400);
  }

  const payload = c.req.valid('json');
  const [folder] = await db
    .select()
    .from(folders)
    .where(and(eq(folders.id, payload.folderId), eq(folders.workspaceId, workspaceId)));
  if (!folder) {
    return c.json({ message: 'Folder not found' }, 404);
  }

  if (payload.organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, payload.organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) return c.json({ message: 'Not found' }, 404);
  }

  const id = createId();
  const data = buildInitiativeData(payload);
  
  // S'assurer que name est présent dans data (obligatoire)
  if (!data.name) {
    data.name = payload.name;
  }
  
  await db.insert(initiatives).values({
    id,
    workspaceId,
    folderId: payload.folderId,
    organizationId: payload.organizationId,
    // data est InitiativeData (garanti par buildInitiativeData), converti en InitiativeDataJson pour compatibilité Drizzle JSONB
    data: data as InitiativeDataJson // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
  });
  const [record] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  const hydrated = await hydrateInitiative(record);
  return c.json(hydrated, 201);
});

initiativesRouter.get('/:id', async (c) => {
  const user = c.get('user') as { role?: string; workspaceId: string };
  const targetWorkspaceId = user.workspaceId;
  const id = c.req.param('id')!;
  const [record] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, targetWorkspaceId)));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }
  const hydrated = await hydrateInitiative(record);
  return c.json(hydrated);
});

initiativesRouter.put('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', initiativeInput.partial()), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;
  const payload = c.req.valid('json');
  const [record] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'initiative',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  
  // Extraire data existant pour le merge
  let existingData: Partial<InitiativeData> = {};
  try {
    if (record.data && typeof record.data === 'object') {
      existingData = record.data as Partial<InitiativeData>;
    } else if (typeof record.data === 'string') {
      existingData = JSON.parse(record.data) as Partial<InitiativeData>;
    }
  } catch (error) {
    existingData = {};
  }
  
  // Construire le nouveau data en mergeant avec l'existant
  // buildInitiativeData garantit toujours un name défini
  let newData = buildInitiativeData(payload, existingData);
  
  // Rétrocompatibilité : si name n'est toujours pas défini (cas edge), utiliser la colonne native
  const legacyRecord = record as LegacyInitiativeRow;
  if (!newData.name && legacyRecord.name) {
    newData = { ...newData, name: legacyRecord.name };
  }
  
  const folderId = payload.folderId ?? record.folderId;

  // If folderId changed, validate folder belongs to workspace
  if (payload.folderId) {
    const [folder] = await db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, payload.folderId), eq(folders.workspaceId, workspaceId)))
      .limit(1);
    if (!folder) return c.json({ message: 'Folder not found' }, 404);
  }

  if (payload.organizationId) {
    const [org] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(eq(organizations.id, payload.organizationId), eq(organizations.workspaceId, workspaceId)))
      .limit(1);
    if (!org) return c.json({ message: 'Not found' }, 404);
  }
  
  await db
    .update(initiatives)
    .set({
      folderId,
      organizationId: payload.organizationId ?? record.organizationId,
      // newData est InitiativeData (garanti par buildInitiativeData), converti en InitiativeDataJson pour compatibilité Drizzle JSONB
      data: newData as InitiativeDataJson // Toutes les données métier sont dans data JSONB (inclut name, description, process, technologies, etc.)
    })
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  const [updated] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  const hydrated = await hydrateInitiative(updated);
  await notifyInitiativeEvent(id);
  return c.json(hydrated);
});

// PATCH /:id — partial update supporting maturity_stage transition with gate evaluation (§6.2)
const patchInitiativeInput = z.object({
  maturity_stage: z.string().optional(),
  gate_status: z.string().optional(),
}).passthrough();

initiativesRouter.patch('/:id', requireEditor, requireWorkspaceEditorRole(), zValidator('json', patchInitiativeInput), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;
  const payload = c.req.valid('json');

  const [record] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  if (!record) {
    return c.json({ message: 'Not found' }, 404);
  }

  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'initiative',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }

  // Gate evaluation on maturity_stage transition
  let gateResult = null;
  if (payload.maturity_stage && payload.maturity_stage !== record.maturityStage) {
    gateResult = await evaluateGate(workspaceId, id, payload.maturity_stage);

    if (!gateResult.gate_passed) {
      return c.json({
        message: 'Gate check failed',
        code: 'GATE_BLOCKED',
        gate: gateResult,
      }, 422);
    }
  }

  // Build the update set
  const updateSet: Record<string, unknown> = {};
  if (payload.maturity_stage !== undefined) {
    updateSet.maturityStage = payload.maturity_stage;
  }
  if (payload.gate_status !== undefined) {
    updateSet.gateStatus = payload.gate_status;
  }

  // If maturity_stage changed and gate passed, update gate_status accordingly
  if (payload.maturity_stage && payload.maturity_stage !== record.maturityStage && gateResult) {
    updateSet.gateStatus = gateResult.gate_passed ? 'approved' : 'pending';
  }

  if (Object.keys(updateSet).length === 0) {
    const hydrated = await hydrateInitiative(record);
    return c.json(hydrated);
  }

  await db
    .update(initiatives)
    .set(updateSet)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));

  const [updated] = await db
    .select()
    .from(initiatives)
    .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  const hydrated = await hydrateInitiative(updated);
  await notifyInitiativeEvent(id);

  // Include gate evaluation in response if transition happened
  if (gateResult) {
    return c.json({ ...hydrated, gate: gateResult });
  }
  return c.json(hydrated);
});

initiativesRouter.delete('/:id', requireEditor, requireWorkspaceEditorRole(), async (c) => {
  const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
  const id = c.req.param('id')!;
  try {
    await requireLockOwnershipForMutation({
      userId,
      workspaceId,
      objectType: 'initiative',
      objectId: id,
    });
  } catch (e: unknown) {
    if (isObjectLockedError(e)) return c.json({ message: 'Object is locked', code: 'OBJECT_LOCKED', lock: e.lock }, 409);
    throw e;
  }
  await db.delete(initiatives).where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
  return c.body(null, 204);
});

const generateInput = z.object({
  input: z.string().min(1),
  folder_id: z.string().optional(),
  initiative_count: z.coerce.number().int().min(1).max(25).optional(),
  organization_id: z.string().optional(),
  matrix_mode: z.enum(['organization', 'generate', 'default']).optional(),
  model: z.string().optional(),
  org_ids: z.array(z.string()).optional(),
  create_new_orgs: z.boolean().optional(),
});

initiativesRouter.post('/generate', requireEditor, requireWorkspaceEditorRole(), zValidator('json', generateInput), async (c) => {
  try {
    const { workspaceId, userId, role } = c.get('user') as { workspaceId: string; userId: string; role: string };

    // Neutral workspaces cannot contain initiatives.
    if (await isNeutralWorkspace(workspaceId)) {
      return c.json({ error: 'Neutral workspaces do not support initiatives' }, 400);
    }
    const requestLocale = resolveLocaleFromHeaders({
      appLocaleHeader: c.req.header('x-app-locale'),
      acceptLanguageHeader: c.req.header('accept-language')
    });
    const { input, folder_id, initiative_count, organization_id, matrix_mode, model, org_ids, create_new_orgs } = c.req.valid('json');
    const resolvedOrgIds = Array.from(
      new Set(
        (org_ids ?? []).filter(
          (orgId): orgId is string => typeof orgId === 'string' && orgId.trim().length > 0,
        ),
      ),
    );
    const organizationId =
      organization_id ?? (resolvedOrgIds.length === 1 ? resolvedOrgIds[0] : undefined);
    const isExplicitDefaultMatrixMode = matrix_mode === 'default';

    if (resolvedOrgIds.length > 0) {
      const existingOrganizations = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.workspaceId, workspaceId));
      const existingOrganizationIds = new Set(existingOrganizations.map((organization) => organization.id));
      if (!resolvedOrgIds.every((orgId) => existingOrganizationIds.has(orgId))) {
        return c.json({ message: 'Not found' }, 404);
      }
    }
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings({ userId });
    const selectedModel = model || aiSettings.defaultModel;

    let organizationMatrixTemplate: Record<string, unknown> | null = null;
    if (organizationId) {
      const [org] = await db
        .select()
        .from(organizations)
        .where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId)))
        .limit(1);
      if (!org) return c.json({ message: 'Not found' }, 404);
      organizationMatrixTemplate = parseOrganizationMatrixTemplate(org.data);
    }

    const resolvedMatrixMode: MatrixMode = (() => {
      if (matrix_mode) return matrix_mode;
      if (!organizationId) return 'default';
      return organizationMatrixTemplate ? 'organization' : 'generate';
    })();
    const resolvedMatrixSource: MatrixSource =
      resolvedMatrixMode === 'organization'
        ? 'organization'
        : resolvedMatrixMode === 'generate'
          ? 'prompt'
          : 'default';

    if (resolvedMatrixMode === 'organization' && !organizationId) {
      return c.json({ message: 'matrix_mode=organization requires organization_id' }, 400);
    }
    if (resolvedMatrixMode === 'organization' && !organizationMatrixTemplate) {
      return c.json({ message: 'Organization matrix template not found' }, 400);
    }
    
    let folderId: string | undefined;
    
    // Générer sur un dossier existant si fourni (ex: /dossier/new crée un brouillon)
    if (folder_id) {
      folderId = folder_id;

      const [folder] = await db
        .select({ id: folders.id, organizationId: folders.organizationId, matrixConfig: folders.matrixConfig })
        .from(folders)
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)))
        .limit(1);
      if (!folder) return c.json({ message: 'Not found' }, 404);
      const hasExplicitOrgSelection = organization_id !== undefined || org_ids !== undefined;
      const requestedFolderOrganizationId =
        organizationId ?? (resolvedOrgIds.length === 1 ? resolvedOrgIds[0] : null);

      if (organizationId) {
        // Already validated above; keep defensive check for maintainability.
        const [org] = await db.select({ id: organizations.id }).from(organizations).where(and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId))).limit(1);
        if (!org) return c.json({ message: 'Not found' }, 404);
      }

      await db
        .update(folders)
        .set({
          status: 'generating',
          // Garder la description synchronisée avec l'input (source de vérité côté UI pour /dossier/new)
          description: input,
          organizationId: hasExplicitOrgSelection ? requestedFolderOrganizationId : folder.organizationId,
          matrixConfig:
            resolvedMatrixMode === 'organization'
              ? JSON.stringify(organizationMatrixTemplate)
              : resolvedMatrixMode === 'generate'
                ? null
                : isExplicitDefaultMatrixMode
                  ? JSON.stringify(defaultMatrixConfig)
                  : folder.matrixConfig ?? JSON.stringify(defaultMatrixConfig),
        })
        .where(and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId)));
      await notifyFolderEvent(folderId);
    } else {
      // Sinon, créer un nouveau dossier (comportement par défaut de /use-cases/generate)
      const folderName = `Génération - ${new Date().toLocaleDateString('fr-FR')}`;
      const folderDescription = `Dossier généré automatiquement pour: ${input}`;
      const requestedFolderOrganizationId =
        organizationId ?? (resolvedOrgIds.length === 1 ? resolvedOrgIds[0] : null);
      
      folderId = createId();

      await db.insert(folders).values({
        id: folderId,
        workspaceId,
        name: folderName,
        description: folderDescription,
        organizationId: requestedFolderOrganizationId,
        matrixConfig:
          resolvedMatrixMode === 'organization'
            ? JSON.stringify(organizationMatrixTemplate)
            : resolvedMatrixMode === 'generate'
              ? null
              : JSON.stringify(defaultMatrixConfig),
        status: 'generating'
        // createdAt omitted to use defaultNow() in Postgres
      });
      await notifyFolderEvent(folderId);
    }

    const workflowDispatch = await todoOrchestrationService.startAndDispatchInitiativeGenerationWorkflow(
      { workspaceId, userId, role },
      {
        folderId: folderId!,
        organizationId,
        matrixMode: resolvedMatrixMode,
        input,
        model: selectedModel,
        initiativeCount: initiative_count,
        locale: requestLocale,
        autoCreateOrganizations: create_new_orgs,
        matrixSource: resolvedMatrixSource,
        orgIds: resolvedOrgIds,
      }
    );

    return c.json({
      success: true,
      message: 'Génération démarrée',
      status: 'generating',
      folder_id: folderId,
      created_folder_id: folder_id ? undefined : folderId,
      matrix_mode: resolvedMatrixMode,
      jobId: workflowDispatch.jobId,
      matrixJobId: workflowDispatch.matrixJobId,
      workflow_run_id: workflowDispatch.workflowRunId
    });
    
  } catch (error) {
    console.error('Error in use-cases generate:', error);
    if (error instanceof Error) {
      console.error('Generate error message:', error.message);
      console.error('Generate error stack:', error.stack);
    }
    return c.json(
      { 
        message: 'Failed to generate use cases', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

// Endpoint pour détailler un cas d'usage
const detailInput = z.object({
  model: z.string().optional()
});

initiativesRouter.post('/:id/detail', requireEditor, requireWorkspaceEditorRole(), zValidator('json', detailInput), async (c) => {
  try {
    const { workspaceId, userId } = c.get('user') as { workspaceId: string; userId: string };
    const requestLocale = resolveLocaleFromHeaders({
      appLocaleHeader: c.req.header('x-app-locale'),
      acceptLanguageHeader: c.req.header('accept-language')
    });
    const id = c.req.param('id')!;
    const { model } = c.req.valid('json');
    
    // Récupérer le modèle par défaut depuis les settings si non fourni
    const aiSettings = await settingsService.getAISettings({ userId });
    const selectedModel = model || aiSettings.defaultModel;
    
    // Récupérer le cas d'usage
    const [initiative] = await db
      .select()
      .from(initiatives)
      .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
    if (!initiative) {
      return c.json({ message: 'Cas d\'usage non trouvé' }, 404);
    }
    
    // Récupérer la configuration de la matrice du dossier
    const [folder] = await db
      .select()
      .from(folders)
      .where(and(eq(folders.id, initiative.folderId), eq(folders.workspaceId, workspaceId)));
    if (!folder) {
      return c.json({ message: 'Dossier non trouvé' }, 404);
    }
    
    // matrixConfig parsed but not used in this endpoint
    // const matrixConfig = parseMatrixConfig(folder.matrixConfig ?? null);
    
    // Mettre à jour le statut à "detailing"
    await db.update(initiatives)
      .set({ status: 'detailing' })
      .where(and(eq(initiatives.id, id), eq(initiatives.workspaceId, workspaceId)));
    await notifyInitiativeEvent(id);
    
    // Extraire le nom depuis data JSONB (avec rétrocompatibilité)
    const initiativeData = initiative.data && typeof initiative.data === 'object' 
      ? initiative.data as Partial<InitiativeData>
      : {};
    const legacyInitiative = initiative as LegacyInitiativeRow;
    const initiativeName = initiativeData.name || legacyInitiative.name || 'Cas d\'usage sans nom';
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('initiative_detail', {
      initiativeId: id,
      initiativeName,
      folderId: initiative.folderId,
      model: selectedModel,
      initiatedByUserId: userId,
      locale: requestLocale
    }, { workspaceId, maxRetries: 1 });
    
    return c.json({
      success: true,
      message: 'Détail du cas d\'usage démarré',
      status: 'detailing',
      jobId
    });
    
  } catch (error) {
    console.error('Error starting use case detail:', error);
    return c.json({
      success: false,
      message: 'Erreur lors du démarrage du détail'
    }, 500);
  }
});


export default initiativesRouter;
