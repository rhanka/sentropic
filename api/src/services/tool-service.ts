import { and, desc, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { chatContexts, contextDocuments, contextModificationHistory, folders, organizations, useCases } from '../db/schema';
import { createId } from '../utils/id';
import { getDocumentsBucketName, getObjectBytes } from './storage-s3';
import { extractDocumentInfoFromDocument } from './document-text';
import { callOpenAI } from './openai';
import { defaultPrompts } from '../config/default-prompts';

export type UseCaseFieldUpdate = {
  /**
   * Path du champ à modifier.
   *
   * Convention:
   * - si `path` commence par "data.", on cible le JSONB `use_cases.data`
   * - sinon, on considère que c'est un champ dans `data` (ex: "description" => "data.description")
   */
  path: string;
  value: unknown;
};

export type UpdateUseCaseFieldsInput = {
  useCaseId: string;
  updates: UseCaseFieldUpdate[];
  /** Contexte chat (optionnel) */
  sessionId?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
};

function normalizeDataPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error('Invalid path');
  return trimmed.startsWith('data.') ? trimmed : `data.${trimmed}`;
}

function getPathSegments(path: string): string[] {
  // Simple dot notation (pas de [] pour l’instant)
  // Exemple: data.solution.bullets.0 (0 sera traité comme index si array)
  return path.split('.').map((s) => s.trim()).filter(Boolean);
}

function deepClone<T>(obj: T): T {
  return obj === undefined ? obj : (JSON.parse(JSON.stringify(obj)) as T);
}

function parseJsonOrNull(value: unknown): unknown | null {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function pickObjectFields(obj: Record<string, unknown>, select: string[] | null): Record<string, unknown> {
  if (!select || select.length === 0) return obj;
  const out: Record<string, unknown> = {};
  for (const key of select) {
    const k = String(key).trim();
    if (!k) continue;
    if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  }
  return out;
}

function coerceMarkdownList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && 'key' in (v as Record<string, unknown>)) return String((v as Record<string, unknown>).key ?? '');
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) return null;
  return items.map((s) => `- ${s}`).join('\n');
}

function coerceToolUpdateValue(pathSegments: string[], value: unknown): unknown {
  // Guard: certains champs UI sont des strings markdown (pas des arrays d'objets).
  if (pathSegments.length === 1) {
    const field = pathSegments[0];
    if (field === 'problem' || field === 'solution' || field === 'description') {
      const asList = coerceMarkdownList(value);
      if (asList) return asList;
    }
  }
  return value;
}

function getAtPath(root: unknown, segments: string[]): unknown {
  let cur: unknown = root;
  for (const seg of segments) {
    if (cur == null) return undefined;
    const idx = Number(seg);
    if (Array.isArray(cur) && Number.isInteger(idx)) {
      cur = cur[idx];
      continue;
    }
    if (typeof cur === 'object') {
      cur = (cur as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }
  return cur;
}

// setAtPath supprimé : on utilise maintenant jsonb_set directement dans SQL pour les mises à jour partielles

async function getNextModificationSequence(contextType: string, contextId: string): Promise<number> {
  const result = await db
    .select({ maxSequence: sql<number>`MAX(${contextModificationHistory.sequence})` })
    .from(contextModificationHistory)
    .where(and(eq(contextModificationHistory.contextType, contextType), eq(contextModificationHistory.contextId, contextId)));

  const maxSequence = result[0]?.maxSequence ?? 0;
  return maxSequence + 1;
}

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

function coerceOrganizationMarkdownField(value: unknown): string | undefined {
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
  // Ne pas forcer la stringification d'objets arbitraires (risque [object Object] en UI).
  return undefined;
}

function coerceOrganizationKpis(value: unknown): string | undefined {
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

function coerceOrganizationReferences(
  value: unknown
): Array<{ title: string; url: string; excerpt?: string }> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null))
    .filter((v): v is Record<string, unknown> => !!v)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : String(r.title ?? ''),
      url: typeof r.url === 'string' ? r.url : String(r.url ?? ''),
      excerpt: typeof r.excerpt === 'string' ? r.excerpt : undefined,
    }))
    .filter((r) => r.title.trim() && r.url.trim());
  return out.length ? out : undefined;
}

function coerceOrganizationReferencesOrEmpty(value: unknown): Array<{ title: string; url: string; excerpt?: string }> {
  return coerceOrganizationReferences(value) ?? [];
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

function hydrateOrganizationForTools(row: typeof organizations.$inferSelect): Record<string, unknown> {
  const data = parseOrganizationData(row.data);
  const raw = data as unknown as Record<string, unknown>;
  const legacyKpisCombined = (() => {
    const sector = coerceOrganizationKpis(raw.kpis_sector);
    const org = coerceOrganizationKpis(raw.kpis_org);
    const parts = [sector, org].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean);
    if (parts.length === 0) return undefined;
    return parts.join('\n\n');
  })();
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    industry: data.industry,
    size: data.size,
    // Tolérance aux anciennes écritures (ex: arrays) + normalisation vers markdown string
    products: coerceOrganizationMarkdownField(raw.products) ?? data.products,
    processes: coerceOrganizationMarkdownField(raw.processes) ?? data.processes,
    kpis: coerceOrganizationKpis(raw.kpis ?? data.kpis) ?? legacyKpisCombined,
    challenges: coerceOrganizationMarkdownField(raw.challenges) ?? data.challenges,
    objectives: coerceOrganizationMarkdownField(raw.objectives) ?? data.objectives,
    technologies: coerceOrganizationMarkdownField(raw.technologies) ?? data.technologies,
    references: coerceOrganizationReferences(raw.references ?? data.references) ?? [],
  };
}

export class ToolService {
  // ---------------------------
  // Organizations
  // ---------------------------

  async listOrganizations(opts?: {
    workspaceId?: string | null;
    idsOnly?: boolean | null;
    select?: string[] | null;
  }): Promise<
    | { ids: string[]; count: number }
    | { items: Array<Record<string, unknown>>; selected: string[] | null; count: number }
  > {
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId ? eq(organizations.workspaceId, workspaceId) : undefined;
    const rows = where ? await db.select().from(organizations).where(where) : await db.select().from(organizations);

    if (opts?.idsOnly) {
      return { ids: rows.map((r) => r.id), count: rows.length };
    }

    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    const items = rows.map((r) => pickObjectFields(hydrateOrganizationForTools(r), select));
    return { items, selected: select, count: rows.length };
  }

  async getOrganization(
    organizationId: string,
    opts?: { workspaceId?: string | null; select?: string[] | null }
  ): Promise<{ organizationId: string; data: Record<string, unknown>; selected: string[] | null }> {
    if (!organizationId) throw new Error('organizationId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(organizations.id, organizationId), eq(organizations.workspaceId, workspaceId))
      : eq(organizations.id, organizationId);

    const [row] = await db.select().from(organizations).where(where).limit(1);
    if (!row) throw new Error('Organization not found');

    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    const data = pickObjectFields(hydrateOrganizationForTools(row), select);
    return { organizationId, data, selected: select };
  }

  async updateOrganizationFields(input: {
    organizationId: string;
    updates: Array<{ field: string; value: unknown }>;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
  }): Promise<{ organizationId: string; applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> }> {
    if (!input.organizationId) throw new Error('organizationId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(organizations.id, input.organizationId), eq(organizations.workspaceId, workspaceId))
      : eq(organizations.id, input.organizationId);
    const [row] = await db.select().from(organizations).where(where).limit(1);
    if (!row) throw new Error('Organization not found');

    const before = deepClone(hydrateOrganizationForTools(row));

    const allowed = new Set([
      'name',
      'industry',
      'size',
      'products',
      'processes',
      'kpis',
      'references',
      'challenges',
      'objectives',
      'technologies',
      'status'
    ]);

    const setPayload: Record<string, unknown> = {};
    const dataBefore = parseOrganizationData(row.data);
    const nextData: OrganizationData = { ...dataBefore };
    const applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    for (const u of input.updates) {
      const field = String(u.field ?? '').trim();
      if (!field) throw new Error('Invalid field');
      if (!allowed.has(field)) throw new Error(`Unsupported field: ${field}`);
      const oldValue = (before as Record<string, unknown>)[field];
      let newValue: unknown = u.value;

      // Normalisation durable: le profil organisation est stocké en markdown string pour ces champs.
      if (
        field === 'products' ||
        field === 'processes' ||
        field === 'challenges' ||
        field === 'objectives' ||
        field === 'technologies'
      ) {
        newValue = coerceOrganizationMarkdownField(u.value) ?? (typeof u.value === 'string' ? u.value : '');
      }
      if (field === 'kpis') {
        newValue = coerceOrganizationKpis(u.value) ?? (typeof u.value === 'string' ? u.value : '');
      }
      if (field === 'references') {
        newValue = coerceOrganizationReferencesOrEmpty(u.value);
      }

      if (field === 'name' || field === 'status') {
        setPayload[field] = newValue;
      } else {
        // All business fields are stored in organizations.data JSONB
        (nextData as Record<string, unknown>)[field] = newValue;
        setPayload.data = nextData;
      }

      applied.push({ field, oldValue, newValue });
    }

    setPayload.updatedAt = new Date();

    const updated = await db.update(organizations).set(setPayload).where(where).returning();
    if (updated.length === 0) throw new Error('Organization not found');

    const after = deepClone(hydrateOrganizationForTools(updated[0]));

    await this.notifyOrganizationEvent(input.organizationId);

    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'organization',
        contextId: input.organizationId,
        snapshotBefore: before,
        snapshotAfter: after,
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('organization', input.organizationId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'organization',
        contextId: input.organizationId,
        sessionId,
        messageId,
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
        toolCallId,
        promptId: null,
        promptType: null,
        promptVersionId: null,
        jobId: null,
        sequence: seq,
        createdAt: new Date()
      });
      seq += 1;
    }

    return { organizationId: input.organizationId, applied };
  }

  /**
   * Tool pour lire un use case complet.
   * Retourne la structure `use_cases.data` complète.
   */
  async readUseCase(
    useCaseId: string,
    opts?: { workspaceId?: string | null; select?: string[] | null }
  ): Promise<{
    useCaseId: string;
    data: unknown;
    selected?: string[] | null;
  }> {
    if (!useCaseId) throw new Error('useCaseId is required');

    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, workspaceId))
      : eq(useCases.id, useCaseId);
    const [row] = await db.select().from(useCases).where(where);
    if (!row) throw new Error('Use case not found');

    const data = (row.data ?? {}) as Record<string, unknown>;
    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;

    // Si select est fourni: ne renvoyer qu'un sous-ensemble de data (réduit tokens)
    if (select && select.length > 0) {
      const out: Record<string, unknown> = {};
      for (const key of select) {
        const k = String(key).trim();
        if (!k) continue;
        // Sélection simple (top-level) seulement pour l'instant.
        // Si on veut du dot-notation plus tard, on pourra l'ajouter sans casser l'API.
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          out[k] = data[k];
        }
      }
      return { useCaseId, data: out, selected: select };
    }

    // Retourner la structure data complète (par défaut)
    return {
      useCaseId,
      data,
      selected: null
    };
  }

  /**
   * Tool générique: met à jour un ou plusieurs champs d'un use case.
   * Cible principale: `use_cases.data.*` (JSONB).
   */
  async updateUseCaseFields(input: UpdateUseCaseFieldsInput & { workspaceId?: string | null }): Promise<{
    useCaseId: string;
    applied: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  }> {
    if (!input.useCaseId) throw new Error('useCaseId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(useCases.id, input.useCaseId), eq(useCases.workspaceId, workspaceId))
      : eq(useCases.id, input.useCaseId);
    const [row] = await db.select().from(useCases).where(where);
    if (!row) throw new Error('Use case not found');

    // `use_cases.data` est directement l'objet métier (pas de wrapper "data")
    const originalData = (row.data ?? {}) as unknown;
    const beforeData = deepClone(originalData) as unknown;

    const applied: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];

    // Construire les updates partiels avec jsonb_set pour ne modifier que les champs spécifiés
    const pathSegmentsList: string[][] = [];
    const valuesList: unknown[] = [];
    
    for (const u of input.updates) {
      const fullPath = normalizeDataPath(u.path);
      const segments = getPathSegments(fullPath);
      if (segments[0] !== 'data') throw new Error('Only data.* paths are supported');

      const dataSegments = segments.slice(1);
      if (dataSegments.length === 0) throw new Error('Refusing to overwrite entire data object');

      // Récupérer l'ancienne valeur pour l'historique
      const oldValue = getAtPath(originalData, dataSegments);
      const coercedValue = coerceToolUpdateValue(dataSegments, u.value);
      
      pathSegmentsList.push(dataSegments);
      valuesList.push(coercedValue);
      
      applied.push({ path: fullPath, oldValue, newValue: coercedValue });
    }

    // Construire la requête SQL avec jsonb_set chaînés pour ne modifier que les champs spécifiés
    // jsonb_set(target, path, new_value, create_missing)
    let updateExpression = `COALESCE("data", '{}'::jsonb)`;
    for (let i = 0; i < pathSegmentsList.length; i++) {
      const pathSegments = pathSegmentsList[i];
      const value = valuesList[i];
      // Construire le path PostgreSQL pour jsonb_set (ex: '{problem}' ou '{solution,bullets,0}')
      // Les segments sont déjà des strings, on les joint avec des virgules
      const jsonbPath = `{${pathSegments.join(',')}}`;
      const valueJson = JSON.stringify(value).replace(/'/g, "''"); // Échapper les quotes pour SQL
      updateExpression = `jsonb_set(${updateExpression}, '${jsonbPath}'::text[], '${valueJson}'::jsonb, true)`;
    }

    // En DB: on met à jour uniquement les champs spécifiés via jsonb_set (requête SQL raw)
    const client = await pool.connect();
    try {
      await client.query(
        `UPDATE use_cases SET "data" = ${updateExpression} WHERE id = $1`,
        [input.useCaseId]
      );
    } finally {
      client.release();
    }
    
    // Récupérer les données finales pour l'historique (après update)
    const [updatedRow] = await db.select().from(useCases).where(where);
    const finalData = (updatedRow?.data ?? {}) as unknown;

    // Émettre un événement usecase_update pour rafraîchir l'UI en temps réel
    await this.notifyUseCaseEvent(input.useCaseId);

    // Historique + snapshot (si sessionId fourni)
    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    // snapshotBefore/After au niveau data (suffisant pour Lot A)
    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'usecase',
        contextId: input.useCaseId,
        snapshotBefore: beforeData,
        snapshotAfter: finalData,
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('usecase', input.useCaseId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'usecase',
        contextId: input.useCaseId,
        sessionId,
        messageId,
        field: item.path,
        oldValue: item.oldValue,
        newValue: item.newValue,
        toolCallId,
        promptId: null,
        promptType: null,
        promptVersionId: null,
        jobId: null,
        sequence: seq,
        createdAt: new Date()
      });
      seq += 1;
    }

    return { useCaseId: input.useCaseId, applied };
  }

  // ---------------------------
  // Folders
  // ---------------------------

  async listFolders(opts?: {
    workspaceId?: string | null;
    organizationId?: string | null;
    idsOnly?: boolean | null;
    select?: string[] | null;
  }): Promise<
    | { ids: string[]; count: number }
    | { items: Array<Record<string, unknown>>; selected: string[] | null; count: number }
  > {
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const organizationId = (opts?.organizationId ?? '').trim();

    const where =
      workspaceId && organizationId
        ? and(eq(folders.workspaceId, workspaceId), eq(folders.organizationId, organizationId))
        : workspaceId
          ? eq(folders.workspaceId, workspaceId)
          : organizationId
            ? eq(folders.organizationId, organizationId)
            : undefined;

    const rows = where ? await db.select().from(folders).where(where) : await db.select().from(folders);

    if (opts?.idsOnly) {
      return { ids: rows.map((r) => r.id), count: rows.length };
    }

    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    const items = rows.map((r) => {
      const rec = r as unknown as Record<string, unknown>;
      const parsed = {
        ...rec,
        matrixConfig: parseJsonOrNull(rec.matrixConfig),
        executiveSummary: parseJsonOrNull(rec.executiveSummary)
      };
      return pickObjectFields(parsed, select);
    });
    return { items, selected: select, count: rows.length };
  }

  async getFolder(
    folderId: string,
    opts?: { workspaceId?: string | null; select?: string[] | null }
  ): Promise<{ folderId: string; data: Record<string, unknown>; selected: string[] | null }> {
    if (!folderId) throw new Error('folderId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, folderId);
    const [row] = await db.select().from(folders).where(where).limit(1);
    if (!row) throw new Error('Folder not found');

    const rec = row as unknown as Record<string, unknown>;
    const parsed = {
      ...rec,
      matrixConfig: parseJsonOrNull(rec.matrixConfig),
      executiveSummary: parseJsonOrNull(rec.executiveSummary)
    };

    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    return { folderId, data: pickObjectFields(parsed, select), selected: select };
  }

  async updateFolderFields(input: {
    folderId: string;
    updates: Array<{ field: string; value: unknown }>;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
  }): Promise<{ folderId: string; applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> }> {
    if (!input.folderId) throw new Error('folderId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, input.folderId);

    const [row] = await db.select().from(folders).where(where).limit(1);
    if (!row) throw new Error('Folder not found');

    const before = deepClone(row as unknown as Record<string, unknown>);

    const allowed = new Set(['name', 'description', 'organizationId', 'matrixConfig', 'executiveSummary', 'status']);
    const setPayload: Record<string, unknown> = {};
    const applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    for (const u of input.updates) {
      const field = String(u.field ?? '').trim();
      if (!field) throw new Error('Invalid field');
      if (!allowed.has(field)) throw new Error(`Unsupported field: ${field}`);

      // Validate FK organizationId
      if (field === 'organizationId' && workspaceId) {
        const nextId = typeof u.value === 'string' ? u.value : null;
        if (nextId) {
          const [org] = await db
            .select({ id: organizations.id })
            .from(organizations)
            .where(and(eq(organizations.id, nextId), eq(organizations.workspaceId, workspaceId)))
            .limit(1);
          if (!org) throw new Error('Organization not found');
        }
      }
      const oldValue = (row as unknown as Record<string, unknown>)[field];

      if (field === 'matrixConfig' || field === 'executiveSummary') {
        setPayload[field] = u.value == null ? null : JSON.stringify(u.value);
        applied.push({ field, oldValue: parseJsonOrNull(oldValue), newValue: u.value });
      } else {
        setPayload[field] = u.value;
        applied.push({ field, oldValue, newValue: u.value });
      }
    }

    const updated = await db.update(folders).set(setPayload).where(where).returning();
    if (updated.length === 0) throw new Error('Folder not found');

    const afterRow = updated[0] as unknown as Record<string, unknown>;
    const after = deepClone({
      ...afterRow,
      matrixConfig: parseJsonOrNull(afterRow.matrixConfig),
      executiveSummary: parseJsonOrNull(afterRow.executiveSummary)
    });

    await this.notifyFolderEvent(input.folderId);

    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'folder',
        contextId: input.folderId,
        snapshotBefore: before,
        snapshotAfter: after,
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('folder', input.folderId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'folder',
        contextId: input.folderId,
        sessionId,
        messageId,
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
        toolCallId,
        promptId: null,
        promptType: null,
        promptVersionId: null,
        jobId: null,
        sequence: seq,
        createdAt: new Date()
      });
      seq += 1;
    }

    return { folderId: input.folderId, applied };
  }

  // ---------------------------
  // Matrix (folders.matrixConfig)
  // ---------------------------

  async getMatrix(folderId: string, opts?: { workspaceId?: string | null }): Promise<{
    folderId: string;
    matrixConfig: Record<string, unknown> | null;
  }> {
    if (!folderId) throw new Error('folderId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, folderId);
    const [row] = await db.select({ matrixConfig: folders.matrixConfig }).from(folders).where(where).limit(1);
    if (!row) throw new Error('Folder not found');
    const parsed = parseJsonOrNull(row.matrixConfig) as Record<string, unknown> | null;
    return { folderId, matrixConfig: parsed };
  }

  async updateMatrix(input: {
    folderId: string;
    matrixConfig: unknown;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
  }): Promise<{ folderId: string; applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> }> {
    if (!input.folderId) throw new Error('folderId is required');
    if (input.matrixConfig == null || typeof input.matrixConfig !== 'object') throw new Error('matrixConfig is required');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, input.folderId);

    const [row] = await db.select().from(folders).where(where).limit(1);
    if (!row) throw new Error('Folder not found');

    const beforeRow = row as unknown as Record<string, unknown>;
    const beforeMatrix = parseJsonOrNull(beforeRow.matrixConfig);

    await db
      .update(folders)
      .set({ matrixConfig: JSON.stringify(input.matrixConfig) })
      .where(where);

    await this.notifyFolderEvent(input.folderId);

    const applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [
      { field: 'matrixConfig', oldValue: beforeMatrix, newValue: input.matrixConfig }
    ];

    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'folder',
        contextId: input.folderId,
        snapshotBefore: { matrixConfig: beforeMatrix },
        snapshotAfter: { matrixConfig: input.matrixConfig },
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('folder', input.folderId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'folder',
        contextId: input.folderId,
        sessionId,
        messageId,
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
        toolCallId,
        promptId: null,
        promptType: null,
        promptVersionId: null,
        jobId: null,
        sequence: seq,
        createdAt: new Date()
      });
      seq += 1;
    }

    return { folderId: input.folderId, applied };
  }

  // ---------------------------
  // Executive Summary (folders.executiveSummary)
  // ---------------------------

  async getExecutiveSummary(folderId: string, opts?: { workspaceId?: string | null; select?: string[] | null }): Promise<{
    folderId: string;
    executiveSummary: Record<string, unknown> | null;
    selected: string[] | null;
  }> {
    if (!folderId) throw new Error('folderId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, folderId);

    const [row] = await db.select({ executiveSummary: folders.executiveSummary }).from(folders).where(where).limit(1);
    if (!row) throw new Error('Folder not found');

    const parsed = parseJsonOrNull(row.executiveSummary) as Record<string, unknown> | null;
    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    const out = parsed ? pickObjectFields(parsed, select) : null;
    return { folderId, executiveSummary: out, selected: select };
  }

  async updateExecutiveSummaryFields(input: {
    folderId: string;
    updates: Array<{ field: string; value: unknown }>;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
  }): Promise<{ folderId: string; applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> }> {
    if (!input.folderId) throw new Error('folderId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId))
      : eq(folders.id, input.folderId);

    const [folderRow] = await db.select().from(folders).where(where).limit(1);
    if (!folderRow) throw new Error('Folder not found');

    const beforeObj = (parseJsonOrNull((folderRow as unknown as Record<string, unknown>).executiveSummary) ?? null) as
      | Record<string, unknown>
      | null;
    const before = deepClone(beforeObj ?? {});

    const allowed = new Set(['introduction', 'analyse', 'recommandation', 'synthese_executive', 'references']);
    const applied: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    const next = deepClone(before) as Record<string, unknown>;
    for (const u of input.updates) {
      const field = String(u.field ?? '').trim();
      if (!field) throw new Error('Invalid field');
      if (!allowed.has(field)) throw new Error(`Unsupported field: ${field}`);
      const oldValue = next[field];
      next[field] = u.value;
      applied.push({ field, oldValue, newValue: u.value });
    }

    await db.update(folders).set({ executiveSummary: JSON.stringify(next) }).where(where);
    await this.notifyFolderEvent(input.folderId);

    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'executive_summary',
        contextId: input.folderId,
        snapshotBefore: before,
        snapshotAfter: next,
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('executive_summary', input.folderId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'executive_summary',
        contextId: input.folderId,
        sessionId,
        messageId,
        field: item.field,
        oldValue: item.oldValue,
        newValue: item.newValue,
        toolCallId,
        promptId: null,
        promptType: null,
        promptVersionId: null,
        jobId: null,
        sequence: seq,
        createdAt: new Date()
      });
      seq += 1;
    }

    return { folderId: input.folderId, applied };
  }

  // ---------------------------
  // Use cases list (folder scope)
  // ---------------------------

  async listUseCasesForFolder(
    folderId: string,
    opts?: { workspaceId?: string | null; idsOnly?: boolean | null; select?: string[] | null }
  ): Promise<
    | { ids: string[]; count: number }
    | { items: Array<{ id: string; data: Record<string, unknown> }>; selected: string[] | null; count: number }
  > {
    if (!folderId) throw new Error('folderId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(useCases.folderId, folderId), eq(useCases.workspaceId, workspaceId))
      : eq(useCases.folderId, folderId);

    const rows = await db.select().from(useCases).where(where);

    if (opts?.idsOnly) {
      return { ids: rows.map((r) => r.id), count: rows.length };
    }

    const select = Array.isArray(opts?.select) ? opts?.select.filter((s) => typeof s === 'string' && s.trim()) : null;
    const items = rows.map((r) => {
      const data = (r.data ?? {}) as Record<string, unknown>;
      return { id: r.id, data: pickObjectFields(data, select) };
    });

    return { items, selected: select, count: rows.length };
  }

  /**
   * Émet un événement usecase_update via NOTIFY PostgreSQL pour rafraîchir l'UI en temps réel
   */
  private async notifyUseCaseEvent(useCaseId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ use_case_id: useCaseId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY usecase_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyOrganizationEvent(organizationId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ organization_id: organizationId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY organization_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private async notifyFolderEvent(folderId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ folder_id: folderId });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY folder_events, '${notifyPayload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  // ---------------------------
  // Context Documents (Lot B)
  // ---------------------------

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  }

  private getDataString(data: unknown, key: string): string | null {
    const rec = this.asRecord(data);
    const v = rec[key];
    return typeof v === 'string' ? v : null;
  }

  private getDataNumber(data: unknown, key: string): number | null {
    const rec = this.asRecord(data);
    const v = rec[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }

  private countWords(text: string): number {
    const t = (text || '').trim();
    if (!t) return 0;
    // Split on whitespace; good enough for FR/EN.
    return t.split(/\s+/g).filter(Boolean).length;
  }

  private estimateTokensFromText(text: string): number {
    // Heuristic: tokens ≈ chars / 4. Good enough for gating & chunk sizing (FR/EN).
    const chars = (text || '').length;
    return Math.ceil(chars / 4);
  }

  private chunkTextByApproxTokens(text: string, targetTokens: number): string[] {
    const t = (text || '').trim();
    if (!t) return [];
    const target = Math.max(10_000, Math.floor(targetTokens || 300_000));
    const targetChars = target * 4;
    const out: string[] = [];
    let i = 0;

    while (i < t.length) {
      const end = Math.min(t.length, i + targetChars);
      if (end >= t.length) {
        out.push(t.slice(i));
        break;
      }

      // Try not to cut in the middle of a word: backtrack to the last whitespace in a small window.
      const windowStart = Math.max(i + Math.floor(targetChars * 0.7), i + 1);
      const window = t.slice(windowStart, end);
      const lastWs = window.search(/\s(?![\s\S]*\s)/); // last whitespace in window (via reverse-ish trick)
      const cut =
        lastWs >= 0
          ? windowStart + lastWs + 1
          : t.lastIndexOf(' ', end) > i
            ? t.lastIndexOf(' ', end)
            : end;

      out.push(t.slice(i, cut).trim());
      i = cut;
    }

    return out.filter((s) => s.trim());
  }

  private trimToMaxWords(text: string, maxWords: number): { text: string; trimmed: boolean; words: number } {
    const t = (text || '').trim();
    if (!t) return { text: '', trimmed: false, words: 0 };
    const words = t.split(/\s+/g).filter(Boolean);
    const max = Math.max(1, Math.min(10_000, Math.floor(maxWords || 10_000)));
    if (words.length <= max) return { text: t, trimmed: false, words: words.length };
    return { text: words.slice(0, max).join(' ') + '\n…(tronqué)…', trimmed: true, words: max };
  }

  async listContextDocuments(opts: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'usecase' | 'chat_session';
    contextId: string;
  }): Promise<{
    items: Array<{
      id: string;
      filename: string;
      mimeType: string;
      sizeBytes: number;
      status: string;
      summaryAvailable: boolean;
      createdAt: Date;
      updatedAt: Date | null;
    }>;
  }> {
    const rows = await db
      .select()
      .from(contextDocuments)
      .where(
        and(
          eq(contextDocuments.workspaceId, opts.workspaceId),
          eq(contextDocuments.contextType, opts.contextType),
          eq(contextDocuments.contextId, opts.contextId)
        )
      )
      .orderBy(desc(contextDocuments.createdAt));

    return {
      items: rows.map((r) => ({
        id: r.id,
        filename: r.filename,
        mimeType: r.mimeType,
        sizeBytes: r.sizeBytes,
        status: r.status,
        summaryAvailable: !!(this.getDataString(r.data, 'summary')?.trim()),
        createdAt: r.createdAt,
        updatedAt: r.updatedAt ?? null,
      })),
    };
  }

  async getDocumentSummary(opts: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'usecase' | 'chat_session';
    contextId: string;
    documentId: string;
  }): Promise<{
    documentId: string;
    documentStatus: string;
    summary: string | null;
  }> {
    const [row] = await db
      .select()
      .from(contextDocuments)
      .where(and(eq(contextDocuments.id, opts.documentId), eq(contextDocuments.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!row) throw new Error('Document not found');
    if (row.contextType !== opts.contextType || row.contextId !== opts.contextId) {
      throw new Error('Security: document does not match context');
    }
    if (row.status !== 'ready') {
      throw new Error(`documents.get_summary: document not ready (status="${row.status}")`);
    }
    return {
      documentId: row.id,
      documentStatus: row.status,
      summary: this.getDataString(row.data, 'summary'),
    };
  }

  async getDocumentContent(opts: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'usecase' | 'chat_session';
    contextId: string;
    documentId: string;
    maxChars?: number | null;
  }): Promise<{
    documentId: string;
    documentStatus: string;
    filename: string;
    mimeType: string;
    pages: number | null;
    title: string | null;
    content: string;
    clipped: boolean;
    contentMode: 'full_text' | 'detailed_summary';
    words: number;
    contentWords?: number;
    summary: string | null;
  }> {
    const [row] = await db
      .select()
      .from(contextDocuments)
      .where(and(eq(contextDocuments.id, opts.documentId), eq(contextDocuments.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!row) throw new Error('Document not found');
    if (row.contextType !== opts.contextType || row.contextId !== opts.contextId) {
      throw new Error('Security: document does not match context');
    }

    // Security / spec: do NOT return full content if doc is larger than 10k words.
    const WORDS_FULL_CONTENT_LIMIT = 10_000;

    const storedWords = (() => {
      const extracted = this.asRecord(this.asRecord(row.data).extracted);
      const n = extracted.words;
      return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
    })();

    const storedDetailed = (() => {
      const v = this.getDataString(row.data, 'detailedSummary');
      return v && v.trim() ? v : null;
    })();

    // If the document is not ready yet, allow get_content only for short docs.
    // Tools must remain read-only: job `document_summary` is the single writer for summaries.
    if (row.status !== 'ready') {
      const bucket = getDocumentsBucketName();
      const bytes = await getObjectBytes({ bucket, key: row.storageKey });
      const extracted = await extractDocumentInfoFromDocument({ bytes, filename: row.filename, mimeType: row.mimeType });
      const full = (extracted.text || '').trim();
      const words = this.countWords(full);
      const isLong = words > WORDS_FULL_CONTENT_LIMIT;

      if (isLong) {
        return {
          documentId: row.id,
          documentStatus: row.status,
          filename: row.filename,
          mimeType: row.mimeType,
          pages: typeof extracted.metadata?.pages === 'number' ? extracted.metadata.pages : null,
          title: typeof extracted.metadata?.title === 'string' ? extracted.metadata.title : null,
          content:
            `Contenu indisponible: document long en cours de traitement (status="${row.status}"). ` +
            `Réessayer une fois le statut "ready".`,
          clipped: true,
          contentMode: 'detailed_summary',
          words,
          contentWords: 0,
          summary: this.getDataString(row.data, 'summary'),
        };
      }

      let content = full;
      let clipped = false;
      const maxChars = typeof opts.maxChars === 'number' ? opts.maxChars : null;
      if (typeof maxChars === 'number') {
        const max = Math.max(1000, Math.min(50_000, Number.isFinite(maxChars) ? maxChars : 30_000));
        clipped = content.length > max;
        content = clipped ? content.slice(0, max) + '\n…(tronqué)…' : content;
      }

      return {
        documentId: row.id,
        documentStatus: row.status,
        filename: row.filename,
        mimeType: row.mimeType,
        pages: typeof extracted.metadata?.pages === 'number' ? extracted.metadata.pages : null,
        title: typeof extracted.metadata?.title === 'string' ? extracted.metadata.title : null,
        content,
        clipped,
        contentMode: 'full_text',
        words,
        contentWords: this.countWords(content),
        summary: this.getDataString(row.data, 'summary'),
      };
    }

    // Fast-path: if we already have a persisted detailed summary and a word count showing it's a big doc,
    // return it without downloading/extracting the file again.
    if (storedWords != null && storedWords > WORDS_FULL_CONTENT_LIMIT && storedDetailed) {
      const extracted = this.asRecord(this.asRecord(row.data).extracted);

      const trimmedStored = this.trimToMaxWords(storedDetailed, WORDS_FULL_CONTENT_LIMIT);
      return {
        documentId: row.id,
        documentStatus: row.status,
        filename: row.filename,
        mimeType: row.mimeType,
        pages: typeof extracted.pages === 'number' ? extracted.pages : null,
        title: typeof extracted.title === 'string' ? extracted.title : null,
        content: trimmedStored.text,
        clipped: trimmedStored.trimmed,
        contentMode: 'detailed_summary',
        words: storedWords,
        contentWords: trimmedStored.words,
        summary: this.getDataString(row.data, 'summary')
      };
    }

    const bucket = getDocumentsBucketName();
    const bytes = await getObjectBytes({ bucket, key: row.storageKey });
    const extracted = await extractDocumentInfoFromDocument({ bytes, filename: row.filename, mimeType: row.mimeType });
    const full = (extracted.text || '').trim();
    const words = this.countWords(full);

    let contentMode: 'full_text' | 'detailed_summary' = 'full_text';
    let content = full;
    let clipped = false;

    if (words > WORDS_FULL_CONTENT_LIMIT) {
      contentMode = 'detailed_summary';
      // Prefer persisted detailed summary when available.
      if (storedDetailed) {
        const trimmedStored = this.trimToMaxWords(storedDetailed, WORDS_FULL_CONTENT_LIMIT);
        content = trimmedStored.text;
        clipped = trimmedStored.trimmed;
      } else {
        content =
          'Résumé détaillé indisponible: le job de résumé n’a pas encore produit ce champ. ' +
          'Relancer le job document_summary ou attendre sa fin.';
        clipped = true;
      }
    } else {
      // Optional: allow callers to bound by chars (legacy), but default is full text.
      const maxChars = typeof opts.maxChars === 'number' ? opts.maxChars : null;
      if (typeof maxChars === 'number') {
        const max = Math.max(1000, Math.min(50_000, Number.isFinite(maxChars) ? maxChars : 30_000));
        clipped = content.length > max;
        content = clipped ? content.slice(0, max) + '\n…(tronqué)…' : content;
      }
    }

    return {
      documentId: row.id,
      documentStatus: row.status,
      filename: row.filename,
      mimeType: row.mimeType,
      pages: typeof extracted.metadata.pages === 'number' ? extracted.metadata.pages : null,
      title: typeof extracted.metadata.title === 'string' ? extracted.metadata.title : null,
      content,
      clipped,
      contentMode,
      words,
      contentWords: contentMode === 'detailed_summary' ? this.countWords(content) : undefined,
      summary: this.getDataString(row.data, 'summary')
    };
  }

  async analyzeDocument(opts: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'usecase' | 'chat_session';
    contextId: string;
    documentId: string;
    prompt: string;
    maxWords?: number | null;
    signal?: AbortSignal;
  }): Promise<{
    documentId: string;
    documentStatus: string;
    filename: string;
    mode: 'full_text' | 'detailed_summary';
    analysis: string;
    analysisWords: number;
    clipped: boolean;
    summary: string | null;
  }> {
    // IMPORTANT (temporary): force a dedicated model for document analysis sub-agent.
    // We intentionally ignore the admin default model until prompts/models are versioned per prompt in DB.
    const model = 'gpt-4.1-nano';
    const p = (opts.prompt || '').trim();
    if (!p) throw new Error('documents.analyze: prompt is required');
    const maxWords = Math.max(500, Math.min(10_000, Math.floor(opts.maxWords ?? 10_000)));

    // IMPORTANT:
    // documents.analyze must be able to question the FULL extracted text, even for very long documents.
    // It must NOT fallback to the detailed summary (that behavior is reserved for documents.get_content).
    const [row] = await db
      .select()
      .from(contextDocuments)
      .where(and(eq(contextDocuments.id, opts.documentId), eq(contextDocuments.workspaceId, opts.workspaceId)))
      .limit(1);
    if (!row) throw new Error('Document not found');
    if (row.contextType !== opts.contextType || row.contextId !== opts.contextId) {
      throw new Error('Security: document does not match context');
    }
    if (row.status !== 'ready') {
      throw new Error(`documents.get_summary: document not ready (status="${row.status}")`);
    }

    const bucket = getDocumentsBucketName();
    const bytes = await getObjectBytes({ bucket, key: row.storageKey });
    const extracted = await extractDocumentInfoFromDocument({ bytes, filename: row.filename, mimeType: row.mimeType });
    const fullText = (extracted.text || '').trim();
    if (!fullText) throw new Error('No text extracted from document (empty or image-only PDF).');
    const fullWords = this.countWords(fullText);
    const estTokens = this.estimateTokensFromText(fullText);

    const template = defaultPrompts.find((p0) => p0.id === 'documents_analyze')?.content || '';
    if (!template) throw new Error('Prompt documents_analyze non trouvé');

    const pageValue = typeof extracted.metadata.pages === 'number' ? String(extracted.metadata.pages) : 'Non précisé';
    const titleValue =
      typeof extracted.metadata.title === 'string' && extracted.metadata.title.trim() ? extracted.metadata.title.trim() : 'Non précisé';

    // If it fits: single-call analysis on full extracted text.
    if (estTokens > 0 && estTokens <= 700_000) {
      const user = template
        .replace('{{lang}}', 'français')
        .replace('{{max_words}}', String(maxWords))
        .replace('{{filename}}', row.filename)
        .replace('{{pages}}', pageValue)
        .replace('{{title}}', titleValue)
        .replace('{{full_words}}', String(fullWords))
        .replace('{{est_tokens}}', String(estTokens))
        .replace('{{scope}}', 'texte intégral extrait')
        .replace('{{document_text}}', fullText)
        .replace('{{instruction}}', p);

      const resp = await callOpenAI({
        messages: [
          { role: 'user', content: user }
        ],
        model,
        // Avoid truncation for long analyses; still trimmed by maxWords at the end.
        maxOutputTokens: 25000,
        signal: opts.signal
      });

      const raw = String(resp.choices?.[0]?.message?.content ?? '').trim();
      const trimmed = this.trimToMaxWords(raw, maxWords);
      return {
        documentId: row.id,
        documentStatus: row.status,
        filename: row.filename,
        mode: 'full_text',
        analysis: trimmed.text,
        analysisWords: trimmed.words,
        clipped: trimmed.trimmed,
        summary: this.getDataString(row.data, 'summary')
      };
    }

    // Large doc: scan ALL chunks (no retrieval/RAG), then consolidate.
    const chunks = this.chunkTextByApproxTokens(fullText, 300_000);
    const chunkAnalyses: string[] = [];
    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const perChunkUser = template
        .replace('{{lang}}', 'français')
        .replace('{{max_words}}', String(1500))
        .replace('{{filename}}', row.filename)
        .replace('{{pages}}', pageValue)
        .replace('{{title}}', titleValue)
        .replace('{{full_words}}', String(fullWords))
        .replace('{{est_tokens}}', String(estTokens))
        .replace('{{scope}}', `extrait ${i + 1}/${chunks.length}`)
        .replace('{{document_text}}', chunk)
        .replace('{{instruction}}', p);

      const resp = await callOpenAI({
        messages: [
          { role: 'user', content: perChunkUser }
        ],
        model,
        // Per-chunk notes; bounded for cost and determinism. The final merge is also bounded.
        maxOutputTokens: 6000,
        signal: opts.signal
      });
      chunkAnalyses.push(String(resp.choices?.[0]?.message?.content ?? '').trim());
    }

    const mergeTemplate = defaultPrompts.find((p0) => p0.id === 'documents_analyze_merge')?.content || '';
    if (!mergeTemplate) throw new Error('Prompt documents_analyze_merge non trouvé');
    const notes = chunkAnalyses.map((a, i) => `### Extrait ${i + 1}/${chunkAnalyses.length}\n${a}`).join('\n\n');
    const mergeUser = mergeTemplate
      .replace('{{lang}}', 'français')
      .replace('{{max_words}}', String(maxWords))
      .replace('{{filename}}', row.filename)
      .replace('{{pages}}', pageValue)
      .replace('{{title}}', titleValue)
      .replace('{{full_words}}', String(fullWords))
      .replace('{{est_tokens}}', String(estTokens))
      .replace('{{notes}}', notes)
      .replace('{{instruction}}', p);

    const merged = await callOpenAI({
      messages: [
        { role: 'user', content: mergeUser }
      ],
      model,
      maxOutputTokens: 20000,
      signal: opts.signal
    });

    const raw = String(merged.choices?.[0]?.message?.content ?? '').trim();
    const trimmed = this.trimToMaxWords(raw, maxWords);
    return {
      documentId: row.id,
      documentStatus: row.status,
      filename: row.filename,
      mode: 'full_text',
      analysis: trimmed.text,
      analysisWords: trimmed.words,
      clipped: trimmed.trimmed,
      summary: this.getDataString(row.data, 'summary')
    };
  }
}

export const toolService = new ToolService();


