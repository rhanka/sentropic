import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import {
  chatMessages,
  chatSessions,
  chatContexts,
  comments,
  contextDocuments,
  contextModificationHistory,
  folders,
  organizations,
  initiatives,
  solutions,
  products,
  bids,
  workspaces,
  users,
  workspaceMemberships
} from '../db/schema';
import { createId } from '../utils/id';
import { getDocumentsBucketName, getObjectBytes } from './storage-s3';
import { extractDocumentInfoFromDocument } from './document-text';
import { callLLM } from './llm-runtime';
import { SHARED_AGENTS } from '../config/default-agents-shared';
import type { CommentContextType, CommentThreadSummary, CommentUserLabel } from './context-comments';
import { hasWorkspaceRole } from './workspace-access';
import { evaluateGate } from './gate-service';
import { type AppLocale, normalizeLocale } from '../utils/locale';

export type InitiativeFieldUpdate = {
  /**
   * Path du champ à modifier.
   *
   * Convention:
   * - si `path` commence par "data.", on cible le JSONB `initiatives.data`
   * - sinon, on considère que c'est un champ dans `data` (ex: "description" => "data.description")
   */
  path: string;
  value: unknown;
};

export type UpdateInitiativeFieldsInput = {
  initiativeId: string;
  updates: InitiativeFieldUpdate[];
  /** Contexte chat (optionnel) */
  userId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  toolCallId?: string | null;
};

const USECASE_FIELD_ALIASES: Record<string, string> = {
  contraintes: 'constraints',
};

function normalizeDataPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error('Invalid path');
  const normalized = trimmed.startsWith('data.') ? trimmed.slice('data.'.length) : trimmed;
  const firstSegment = normalized.split('.')[0] || normalized;
  const mapped = USECASE_FIELD_ALIASES[firstSegment] ?? firstSegment;
  const rest = normalized.slice(firstSegment.length);
  return `data.${mapped}${rest}`;
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

const LIST_FIELDS = new Set([
  'benefits',
  'risks',
  'constraints',
  'metrics',
  'nextSteps',
  'technologies',
  'dataSources',
  'dataObjects'
]);

function coerceListArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && 'key' in (v as Record<string, unknown>)) {
        return String((v as Record<string, unknown>).key ?? '');
      }
      return '';
    })
    .map((s) => s.trim())
    .filter(Boolean);
  return items;
}

function coerceMarkdownStringToArray(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return [];
  const lines = trimmed.replace(/\r\n/g, '\n').split('\n');
  const items = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\s*(?:[-*+]|(?:\d+\.)|\u2022|\u2023|\u25e6)\s+/, '').trim())
    .filter(Boolean);
  return items;
}

function coerceToolUpdateValue(pathSegments: string[], value: unknown): unknown {
  // Guard: certains champs UI sont des strings markdown (pas des arrays d'objets).
  if (pathSegments.length === 1) {
    const field = pathSegments[0];
    if (field === 'problem' || field === 'solution' || field === 'description') {
      const asList = coerceMarkdownList(value);
      if (asList) return asList;
    }
    if (LIST_FIELDS.has(field)) {
      const asArray = coerceListArray(value) ?? coerceMarkdownStringToArray(value);
      if (asArray) return asArray;
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
    userId?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
    locale?: string;
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

    const commentAuthorId = await this.resolveCommentAuthorId({
      explicitUserId: input.userId,
      sessionId
    });
    const updatedWorkspaceId = (() => {
      const candidate = (updated[0] as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const commentWorkspaceId = workspaceId || updatedWorkspaceId;
    if (commentAuthorId && commentWorkspaceId) {
      await this.createAutoFieldComments({
        workspaceId: commentWorkspaceId,
        contextType: 'organization',
        contextId: input.organizationId,
        sectionKeys: applied.map((item) => item.field),
        createdBy: commentAuthorId,
        assignedTo: commentAuthorId,
        toolCallId,
        locale: input.locale
      });
    }

    return { organizationId: input.organizationId, applied };
  }

  /**
   * Tool pour lire un use case complet.
   * Retourne la structure `initiatives.data` complète.
   */
  async readInitiative(
    initiativeId: string,
    opts?: { workspaceId?: string | null; select?: string[] | null }
  ): Promise<{
    initiativeId: string;
    data: unknown;
    selected?: string[] | null;
  }> {
    if (!initiativeId) throw new Error('initiativeId is required');

    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, workspaceId))
      : eq(initiatives.id, initiativeId);
    const [row] = await db.select().from(initiatives).where(where);
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
      return { initiativeId, data: out, selected: select };
    }

    // Retourner la structure data complète (par défaut)
    return {
      initiativeId,
      data,
      selected: null
    };
  }

  /**
   * Tool générique: met à jour un ou plusieurs champs d'un use case.
   * Cible principale: `initiatives.data.*` (JSONB).
   */
  async updateInitiativeFields(input: UpdateInitiativeFieldsInput & { workspaceId?: string | null; locale?: string }): Promise<{
    initiativeId: string;
    applied: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  }> {
    if (!input.initiativeId) throw new Error('initiativeId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const workspaceId = (input.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(initiatives.id, input.initiativeId), eq(initiatives.workspaceId, workspaceId))
      : eq(initiatives.id, input.initiativeId);
    const [row] = await db.select().from(initiatives).where(where);
    if (!row) throw new Error('Use case not found');

    // `initiatives.data` est directement l'objet métier (pas de wrapper "data")
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
        `UPDATE initiatives SET "data" = ${updateExpression} WHERE id = $1`,
        [input.initiativeId]
      );
    } finally {
      client.release();
    }
    
    // Récupérer les données finales pour l'historique (après update)
    const [updatedRow] = await db.select().from(initiatives).where(where);
    const finalData = (updatedRow?.data ?? {}) as unknown;

    // Émettre un événement usecase_update pour rafraîchir l'UI en temps réel
    await this.notifyInitiativeEvent(input.initiativeId);

    // Historique + snapshot (si sessionId fourni)
    const sessionId = input.sessionId ?? null;
    const messageId = input.messageId ?? null;
    const toolCallId = input.toolCallId ?? null;

    // snapshotBefore/After au niveau data (suffisant pour Lot A)
    if (sessionId) {
      await db.insert(chatContexts).values({
        id: createId(),
        sessionId,
        contextType: 'initiative',
        contextId: input.initiativeId,
        snapshotBefore: beforeData,
        snapshotAfter: finalData,
        modifications: applied,
        modifiedAt: new Date(),
        createdAt: new Date()
      });
    }

    let seq = await getNextModificationSequence('initiative', input.initiativeId);
    for (const item of applied) {
      await db.insert(contextModificationHistory).values({
        id: createId(),
        contextType: 'initiative',
        contextId: input.initiativeId,
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

    const commentAuthorId = await this.resolveCommentAuthorId({
      explicitUserId: input.userId,
      sessionId
    });
    const rowWorkspaceId = (() => {
      const candidate = (row as unknown as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const updatedWorkspaceId = (() => {
      const candidate = (updatedRow as unknown as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const commentWorkspaceId = workspaceId || rowWorkspaceId || updatedWorkspaceId;
    if (commentAuthorId && commentWorkspaceId) {
      await this.createAutoFieldComments({
        workspaceId: commentWorkspaceId,
        contextType: 'initiative',
        contextId: input.initiativeId,
        sectionKeys: applied.map((item) => item.path),
        createdBy: commentAuthorId,
        assignedTo: commentAuthorId,
        toolCallId,
        locale: input.locale
      });
    }

    return { initiativeId: input.initiativeId, applied };
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
    userId?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
    locale?: string;
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

    const commentAuthorId = await this.resolveCommentAuthorId({
      explicitUserId: input.userId,
      sessionId
    });
    const updatedWorkspaceId = (() => {
      const candidate = (updated[0] as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const commentWorkspaceId = workspaceId || updatedWorkspaceId;
    if (commentAuthorId && commentWorkspaceId) {
      await this.createAutoFieldComments({
        workspaceId: commentWorkspaceId,
        contextType: 'folder',
        contextId: input.folderId,
        sectionKeys: applied.map((item) => item.field),
        createdBy: commentAuthorId,
        assignedTo: commentAuthorId,
        toolCallId,
        locale: input.locale
      });
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
    userId?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
    locale?: string;
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

    const commentAuthorId = await this.resolveCommentAuthorId({
      explicitUserId: input.userId,
      sessionId
    });
    const rowWorkspaceId = (() => {
      const candidate = (row as unknown as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const commentWorkspaceId = workspaceId || rowWorkspaceId;
    if (commentAuthorId && commentWorkspaceId) {
      await this.createAutoFieldComments({
        workspaceId: commentWorkspaceId,
        contextType: 'matrix',
        contextId: input.folderId,
        sectionKeys: applied.map((item) => item.field),
        createdBy: commentAuthorId,
        assignedTo: commentAuthorId,
        toolCallId,
        locale: input.locale
      });
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
    userId?: string | null;
    workspaceId?: string | null;
    sessionId?: string | null;
    messageId?: string | null;
    toolCallId?: string | null;
    locale?: string;
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

    const commentAuthorId = await this.resolveCommentAuthorId({
      explicitUserId: input.userId,
      sessionId
    });
    const rowWorkspaceId = (() => {
      const candidate = (folderRow as unknown as Record<string, unknown>)?.workspaceId;
      return typeof candidate === 'string' ? candidate.trim() : '';
    })();
    const commentWorkspaceId = workspaceId || rowWorkspaceId;
    if (commentAuthorId && commentWorkspaceId) {
      await this.createAutoFieldComments({
        workspaceId: commentWorkspaceId,
        contextType: 'executive_summary',
        contextId: input.folderId,
        sectionKeys: applied.map((item) => item.field),
        createdBy: commentAuthorId,
        assignedTo: commentAuthorId,
        toolCallId,
        locale: input.locale
      });
    }

    return { folderId: input.folderId, applied };
  }

  // ---------------------------
  // Use cases list (folder scope)
  // ---------------------------

  async listInitiativesForFolder(
    folderId: string,
    opts?: { workspaceId?: string | null; idsOnly?: boolean | null; select?: string[] | null }
  ): Promise<
    | { ids: string[]; count: number }
    | { items: Array<{ id: string; data: Record<string, unknown> }>; selected: string[] | null; count: number }
  > {
    if (!folderId) throw new Error('folderId is required');
    const workspaceId = (opts?.workspaceId ?? '').trim();
    const where = workspaceId
      ? and(eq(initiatives.folderId, folderId), eq(initiatives.workspaceId, workspaceId))
      : eq(initiatives.folderId, folderId);

    const rows = await db.select().from(initiatives).where(where);

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

  // ---------------------------
  // Comments (assistant support)
  // ---------------------------

  private async ensureWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
    if (!userId || !workspaceId) return false;
    const [row] = await db
      .select({ userId: workspaceMemberships.userId })
      .from(workspaceMemberships)
      .where(and(eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, userId)))
      .limit(1);
    return !!row;
  }

  async listCommentThreadsForContexts(opts: {
    workspaceId: string;
    contexts: Array<{ contextType: CommentContextType; contextId: string }>;
    status?: 'open' | 'closed' | null;
    sectionKey?: string | null;
    threadId?: string | null;
    limit?: number | null;
  }): Promise<{ threads: CommentThreadSummary[]; users: CommentUserLabel[] }> {
    const workspaceId = (opts.workspaceId || '').trim();
    if (!workspaceId) throw new Error('workspaceId is required');
    if (!opts.contexts || opts.contexts.length === 0) {
      return { threads: [], users: [] };
    }

    const contextConditions = opts.contexts.map((c) =>
      and(eq(comments.contextType, c.contextType), eq(comments.contextId, c.contextId))
    );
    const conditions = [eq(comments.workspaceId, workspaceId), or(...contextConditions)];
    if (opts.status) conditions.push(eq(comments.status, opts.status));
    if (opts.sectionKey) conditions.push(eq(comments.sectionKey, opts.sectionKey));
    if (opts.threadId) conditions.push(eq(comments.threadId, opts.threadId));

    const rows = await db
      .select({
        id: comments.id,
        threadId: comments.threadId,
        contextType: comments.contextType,
        contextId: comments.contextId,
        sectionKey: comments.sectionKey,
        createdBy: comments.createdBy,
        assignedTo: comments.assignedTo,
        status: comments.status,
        content: comments.content,
        createdAt: comments.createdAt,
        updatedAt: comments.updatedAt,
      })
      .from(comments)
      .where(and(...conditions))
      .orderBy(asc(comments.createdAt));

    const byThread = new Map<string, CommentThreadSummary>();
    const userIds = new Set<string>();

    for (const row of rows) {
      if (row.createdBy) userIds.add(row.createdBy);
      if (row.assignedTo) userIds.add(row.assignedTo);
      const key = row.threadId;
      const createdAt = row.createdAt?.toISOString() ?? new Date().toISOString();
      const updatedAt = row.updatedAt ? row.updatedAt.toISOString() : null;
      if (!byThread.has(key)) {
        byThread.set(key, {
          threadId: row.threadId,
          contextType: row.contextType as CommentContextType,
          contextId: row.contextId,
          sectionKey: row.sectionKey ?? null,
          status: row.status === 'closed' ? 'closed' : 'open',
          assignedTo: row.assignedTo ?? null,
          createdBy: row.createdBy,
          createdAt,
          updatedAt,
          messageCount: 1,
          rootMessage: row.content,
          rootMessageAt: createdAt,
          lastMessage: row.content,
          lastMessageAt: createdAt
        });
      } else {
        const current = byThread.get(key)!;
        current.messageCount += 1;
        current.lastMessage = row.content;
        current.lastMessageAt = createdAt;
        current.updatedAt = updatedAt ?? current.updatedAt;
        current.status = row.status === 'closed' ? 'closed' : current.status;
        if (!current.assignedTo && row.assignedTo) current.assignedTo = row.assignedTo;
      }
    }

    const usersRows =
      userIds.size > 0
        ? await db
            .select({ id: users.id, email: users.email, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, Array.from(userIds)))
        : [];

    return {
      threads: Array.from(byThread.values()).slice(0, opts.limit ?? 200),
      users: usersRows.map((u) => ({ id: u.id, email: u.email, displayName: u.displayName }))
    };
  }

  async resolveCommentActions(opts: {
    workspaceId: string;
    userId: string;
    allowedContexts: Array<{ contextType: CommentContextType; contextId: string }>;
    actions: Array<{
      thread_id: string;
      action: 'close' | 'reassign' | 'note';
      reassign_to?: string | null;
      note?: string | null;
    }>;
    toolCallId?: string | null;
  }): Promise<{
    applied: Array<{ thread_id: string; action: string; status: string }>;
    notes: Array<{ thread_id: string; note_id: string }>;
  }> {
    const workspaceId = (opts.workspaceId || '').trim();
    const userId = (opts.userId || '').trim();
    if (!workspaceId || !userId) throw new Error('workspaceId and userId are required');
    if (!Array.isArray(opts.actions) || opts.actions.length === 0) throw new Error('actions is required');
    if (opts.actions.length > 50) throw new Error('Too many actions (max 50)');

    const allowedSet = new Set(opts.allowedContexts.map((c) => `${c.contextType}:${c.contextId}`));
    const applied: Array<{ thread_id: string; action: string; status: string }> = [];
    const notes: Array<{ thread_id: string; note_id: string }> = [];
    const isAdmin = await hasWorkspaceRole(userId, workspaceId, 'admin');

    const actionsByThread = new Map<string, typeof opts.actions>();
    for (const action of opts.actions) {
      const threadId = String(action.thread_id || '').trim();
      if (!threadId) continue;
      const list = actionsByThread.get(threadId) ?? [];
      list.push(action);
      actionsByThread.set(threadId, list);
    }

    for (const [threadId, actions] of actionsByThread.entries()) {
      const [row] = await db
        .select({
          id: comments.id,
          threadId: comments.threadId,
          contextType: comments.contextType,
          contextId: comments.contextId,
          sectionKey: comments.sectionKey,
          createdBy: comments.createdBy,
          assignedTo: comments.assignedTo,
          status: comments.status
        })
        .from(comments)
        .where(and(eq(comments.workspaceId, workspaceId), eq(comments.threadId, threadId)))
        .orderBy(asc(comments.createdAt))
        .limit(1);

      if (!row) throw new Error(`Thread not found: ${threadId}`);
      if (!allowedSet.has(`${row.contextType}:${row.contextId}`)) {
        throw new Error('Security: thread context is not allowed');
      }

      const canComment = await hasWorkspaceRole(userId, workspaceId, 'commenter');
      if (!canComment) {
        throw new Error('Workspace commenter role required');
      }
      const isCreator = row.createdBy === userId;

      const now = new Date();
      let latestAssigned = row.assignedTo ?? null;
      let latestStatus: 'open' | 'closed' = row.status === 'closed' ? 'closed' : 'open';
      let resolutionMessage: string | null = null;
      let explicitNote: string | null = null;

      for (const action of actions) {
        if (action.action === 'close') {
          if (!isAdmin && !isCreator) {
            throw new Error('Only the thread creator or admin can resolve this thread');
          }
          await db
            .update(comments)
            .set({ status: 'closed', updatedAt: now })
            .where(and(eq(comments.workspaceId, workspaceId), eq(comments.threadId, threadId)));
          await this.notifyCommentEvent(workspaceId, row.contextType, row.contextId, { action: 'closed', thread_id: threadId });
          applied.push({ thread_id: threadId, action: 'close', status: 'closed' });
          resolutionMessage = 'Clôture automatique.';
          latestStatus = 'closed';
        } else if (action.action === 'reassign') {
          if (!isAdmin && !isCreator) {
            throw new Error('Only the thread creator or admin can resolve this thread');
          }
          const target = (action.reassign_to ?? '').trim();
          if (!target) throw new Error('reassign_to is required');
          if (!(await this.ensureWorkspaceMember(target, workspaceId))) {
            throw new Error('Assigned user not in workspace');
          }
          await db
            .update(comments)
            .set({ assignedTo: target, updatedAt: now })
            .where(and(eq(comments.workspaceId, workspaceId), eq(comments.threadId, threadId)));
          await this.notifyCommentEvent(workspaceId, row.contextType, row.contextId, { action: 'reassigned', thread_id: threadId });
          applied.push({ thread_id: threadId, action: 'reassign', status: 'updated' });
          latestAssigned = target;
          resolutionMessage = `Réassignation automatique à @${target}.`;
        } else if (action.action === 'note') {
          const note = (action.note ?? '').trim();
          if (!note) throw new Error('note is required');
          explicitNote = note;
        }
      }

      const traceNote = explicitNote || resolutionMessage;

      if (traceNote) {
        const noteId = createId();
        await db.insert(comments).values({
          id: noteId,
          workspaceId,
          contextType: row.contextType,
          contextId: row.contextId,
          sectionKey: row.sectionKey,
          createdBy: userId,
          assignedTo: latestAssigned ?? userId,
          status: latestStatus,
          threadId: threadId,
          content: traceNote,
          toolCallId: opts.toolCallId ?? null,
          createdAt: now,
          updatedAt: now
        });
        await this.notifyCommentEvent(workspaceId, row.contextType, row.contextId, { action: 'created', comment_id: noteId });
        notes.push({ thread_id: threadId, note_id: noteId });
      }
    }

    return { applied, notes };
  }

  /**
   * Émet un événement usecase_update via NOTIFY PostgreSQL pour rafraîchir l'UI en temps réel
   */
  private async notifyInitiativeEvent(initiativeId: string): Promise<void> {
    const notifyPayload = JSON.stringify({ use_case_id: initiativeId });
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

  private async notifyCommentEvent(
    workspaceId: string,
    contextType: string,
    contextId: string,
    data: Record<string, unknown> = {}
  ): Promise<void> {
    const payload = JSON.stringify({ workspace_id: workspaceId, context_type: contextType, context_id: contextId, data });
    const client = await pool.connect();
    try {
      await client.query(`NOTIFY comment_events, '${payload.replace(/'/g, "''")}'`);
    } finally {
      client.release();
    }
  }

  private getAutoFieldLabel(contextType: CommentContextType, sectionKey: string, locale: AppLocale): string {
    const key = String(sectionKey ?? '').trim();
    if (!key) return locale === 'en' ? 'General' : 'General';
    const labelByContext: Record<string, Record<string, { fr: string; en: string }>> = {
      usecase: {
        name: { fr: 'Nom', en: 'Name' },
        description: { fr: 'Description', en: 'Description' },
        problem: { fr: 'Probleme', en: 'Problem' },
        solution: { fr: 'Solution', en: 'Solution' },
        benefits: { fr: 'Benefices recherches', en: 'Target benefits' },
        constraints: { fr: 'Contraintes', en: 'Constraints' },
        metrics: { fr: 'Mesures du succes', en: 'Success metrics' },
        risks: { fr: 'Risques', en: 'Risks' },
        nextSteps: { fr: 'Prochaines etapes', en: 'Next steps' },
        technologies: { fr: 'Technologies', en: 'Technologies' },
        dataSources: { fr: 'Sources des donnees', en: 'Data sources' },
        dataObjects: { fr: 'Donnees', en: 'Data' },
        contact: { fr: 'Contact', en: 'Contact' },
        domain: { fr: 'Domaine', en: 'Domain' },
        deadline: { fr: 'Delai', en: 'Deadline' },
        valueScores: { fr: 'Axes de valeur', en: 'Value axes' },
        complexityScores: { fr: 'Axes de complexite', en: 'Complexity axes' },
      },
      organization: {
        name: { fr: 'Nom', en: 'Name' },
        industry: { fr: 'Secteur', en: 'Industry' },
        size: { fr: 'Taille', en: 'Size' },
        technologies: { fr: 'Technologies', en: 'Technologies' },
        products: { fr: 'Produits et Services', en: 'Products and services' },
        processes: { fr: 'Processus Metier', en: 'Business processes' },
        kpis: { fr: 'Indicateurs de performance', en: 'Performance indicators' },
        challenges: { fr: 'Defis Principaux', en: 'Key challenges' },
        objectives: { fr: 'Objectifs Strategiques', en: 'Strategic objectives' },
        references: { fr: 'References', en: 'References' },
      },
      folder: {
        name: { fr: 'Nom du dossier', en: 'Folder name' },
        description: { fr: 'Contexte', en: 'Context' },
      },
      executive_summary: {
        introduction: { fr: 'Introduction', en: 'Introduction' },
        analyse: { fr: 'Analyse', en: 'Analysis' },
        analysis: { fr: 'Analyse', en: 'Analysis' },
        recommandation: { fr: 'Recommandations', en: 'Recommendations' },
        recommendations: { fr: 'Recommandations', en: 'Recommendations' },
        synthese_executive: { fr: 'Synthese executive', en: 'Executive summary' },
        synthese: { fr: 'Synthese', en: 'Summary' },
        summary: { fr: 'Synthese', en: 'Summary' },
        references: { fr: 'References', en: 'References' },
      },
      matrix: {
        matrixConfig: { fr: 'Configuration de la matrice', en: 'Matrix configuration' },
        matrixTemplate: { fr: 'Modele de matrice', en: 'Matrix template' },
      },
    };
    const localized = labelByContext[contextType]?.[key];
    return localized ? (locale === 'en' ? localized.en : localized.fr) : key;
  }

  private formatAutoFieldComment(contextType: CommentContextType, sectionKey: string, locale: AppLocale): string {
    const localizedField = this.getAutoFieldLabel(contextType, sectionKey, locale);
    if (locale === 'en') {
      return `Field "${localizedField}" was updated by AI assistant. Please review and adjust if needed.`;
    }
    return `Le champ "${localizedField}" a ete modifie par l'assistant IA. Merci de le verifier et de l'ajuster si necessaire.`;
  }

  private async resolveCommentAuthorId(opts: {
    explicitUserId?: string | null;
    sessionId?: string | null;
  }): Promise<string | null> {
    const explicit = (opts.explicitUserId ?? '').trim();
    if (explicit) return explicit;

    const sessionId = (opts.sessionId ?? '').trim();
    if (!sessionId) return null;

    const [sessionRow] = await db
      .select({ userId: chatSessions.userId })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    const userId = (sessionRow?.userId ?? '').trim();
    return userId || null;
  }

  private async createAutoFieldComments(opts: {
    workspaceId: string;
    contextType: CommentContextType;
    contextId: string;
    sectionKeys: string[];
    createdBy: string;
    assignedTo?: string | null;
    toolCallId?: string | null;
    locale?: string;
  }): Promise<void> {
    const workspaceId = (opts.workspaceId ?? '').trim();
    const contextId = (opts.contextId ?? '').trim();
    const createdBy = (opts.createdBy ?? '').trim();
    if (!workspaceId || !contextId || !createdBy) return;

    const assignedTo = (opts.assignedTo ?? '').trim() || createdBy;
    const locale = normalizeLocale(opts.locale) ?? 'fr';
    const uniqueSectionKeys = Array.from(
      new Set(
        opts.sectionKeys
          .map((s) => {
            const sectionKey = String(s ?? '').trim();
            if (!sectionKey) return '';
            return opts.contextType === 'initiative' && sectionKey.startsWith('data.')
              ? sectionKey.slice('data.'.length)
              : sectionKey;
          })
          .filter(Boolean)
      )
    );
    for (const sectionKey of uniqueSectionKeys) {
      const now = new Date();
      const commentId = createId();
      await db.insert(comments).values({
        id: commentId,
        workspaceId,
        contextType: opts.contextType,
        contextId,
        sectionKey,
        createdBy,
        assignedTo,
        status: 'open',
        threadId: createId(),
        content: this.formatAutoFieldComment(opts.contextType, sectionKey, locale),
        toolCallId: opts.toolCallId ?? null,
        createdAt: now,
        updatedAt: now
      });
      await this.notifyCommentEvent(workspaceId, opts.contextType, contextId, { action: 'created', comment_id: commentId });
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

  private getPromptTemplateOrThrow(promptId: string): string {
    for (const agent of SHARED_AGENTS) {
      if (agent.config.promptId === promptId) {
        const t = typeof agent.config.promptTemplate === 'string' ? agent.config.promptTemplate : '';
        if (t) return t;
      }
      if (agent.config.mergePromptTemplate && promptId.endsWith('_merge')) {
        const baseId = promptId.replace(/_merge$/, '');
        if (agent.config.promptId === baseId) {
          const t = typeof agent.config.mergePromptTemplate === 'string' ? agent.config.mergePromptTemplate : '';
          if (t) return t;
        }
      }
    }
    throw new Error(`Prompt ${promptId} non trouvé`);
  }

  private renderTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return Object.entries(variables).reduce((acc, [key, value]) => {
      return acc.replaceAll(`{{${key}}}`, value);
    }, template);
  }

  private async runChunkedPromptAnalysis(options: {
    model: string;
    text: string;
    instruction: string;
    maxWords: number;
    perChunkMaxWords: number;
    singlePassTokenLimit: number;
    chunkTargetTokens: number;
    analysisPromptId: string;
    mergePromptId: string;
    templateVars: Record<string, string>;
    textVarName: string;
    scopeVarName: string;
    instructionVarName: string;
    notesVarName: string;
    signal?: AbortSignal;
  }): Promise<{
    analysis: string;
    analysisWords: number;
    clipped: boolean;
    chunked: boolean;
    chunkCount: number;
  }> {
    const text = (options.text || '').trim();
    if (!text) {
      return {
        analysis: '',
        analysisWords: 0,
        clipped: false,
        chunked: false,
        chunkCount: 0,
      };
    }

    const template = this.getPromptTemplateOrThrow(options.analysisPromptId);
    const mergeTemplate = this.getPromptTemplateOrThrow(options.mergePromptId);
    const estimatedTokens = this.estimateTokensFromText(text);

    const makeTemplateVars = (
      dynamicVars: Record<string, string>,
      maxWordsValue: number,
    ): Record<string, string> => ({
      ...options.templateVars,
      max_words: String(maxWordsValue),
      ...dynamicVars,
    });

    if (estimatedTokens > 0 && estimatedTokens <= options.singlePassTokenLimit) {
      const userPrompt = this.renderTemplate(
        template,
        makeTemplateVars(
          {
            [options.scopeVarName]: 'single_pass',
            [options.textVarName]: text,
            [options.instructionVarName]: options.instruction,
          },
          options.maxWords,
        ),
      );

      const response = await callLLM({
        messages: [{ role: 'user', content: userPrompt }],
        model: options.model,
        maxOutputTokens: 25_000,
        signal: options.signal,
      });

      const raw = String(response.choices?.[0]?.message?.content ?? '').trim();
      const trimmed = this.trimToMaxWords(raw, options.maxWords);
      return {
        analysis: trimmed.text,
        analysisWords: trimmed.words,
        clipped: trimmed.trimmed,
        chunked: false,
        chunkCount: 1,
      };
    }

    const chunks = this.chunkTextByApproxTokens(text, options.chunkTargetTokens);
    const notes: string[] = [];
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index] ?? '';
      const userPrompt = this.renderTemplate(
        template,
        makeTemplateVars(
          {
            [options.scopeVarName]: `chunk_${index + 1}/${chunks.length}`,
            [options.textVarName]: chunk,
            [options.instructionVarName]: options.instruction,
          },
          options.perChunkMaxWords,
        ),
      );
      const response = await callLLM({
        messages: [{ role: 'user', content: userPrompt }],
        model: options.model,
        maxOutputTokens: 6_000,
        signal: options.signal,
      });
      notes.push(String(response.choices?.[0]?.message?.content ?? '').trim());
    }

    const mergedPrompt = this.renderTemplate(
      mergeTemplate,
      makeTemplateVars(
        {
          [options.notesVarName]: notes
            .map((note, index) => `### Chunk ${index + 1}/${notes.length}\n${note}`)
            .join('\n\n'),
          [options.instructionVarName]: options.instruction,
        },
        options.maxWords,
      ),
    );

    const merged = await callLLM({
      messages: [{ role: 'user', content: mergedPrompt }],
      model: options.model,
      maxOutputTokens: 20_000,
      signal: options.signal,
    });

    const raw = String(merged.choices?.[0]?.message?.content ?? '').trim();
    const trimmed = this.trimToMaxWords(raw, options.maxWords);
    return {
      analysis: trimmed.text,
      analysisWords: trimmed.words,
      clipped: trimmed.trimmed,
      chunked: true,
      chunkCount: chunks.length,
    };
  }

  async listContextDocuments(opts: {
    workspaceId: string;
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
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
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
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
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
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
    contextType: 'organization' | 'folder' | 'initiative' | 'chat_session';
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

    const pageValue = typeof extracted.metadata.pages === 'number' ? String(extracted.metadata.pages) : 'Non précisé';
    const titleValue =
      typeof extracted.metadata.title === 'string' && extracted.metadata.title.trim() ? extracted.metadata.title.trim() : 'Non précisé';
    const analyzed = await this.runChunkedPromptAnalysis({
      model,
      text: fullText,
      instruction: p,
      maxWords,
      perChunkMaxWords: 1_500,
      singlePassTokenLimit: 700_000,
      chunkTargetTokens: 300_000,
      analysisPromptId: 'documents_analyze',
      mergePromptId: 'documents_analyze_merge',
      templateVars: {
        lang: 'français',
        filename: row.filename,
        pages: pageValue,
        title: titleValue,
        full_words: String(fullWords),
        est_tokens: String(estTokens),
      },
      textVarName: 'document_text',
      scopeVarName: 'scope',
      instructionVarName: 'instruction',
      notesVarName: 'notes',
      signal: opts.signal,
    });

    return {
      documentId: row.id,
      documentStatus: row.status,
      filename: row.filename,
      mode: 'full_text',
      analysis: analyzed.analysis,
      analysisWords: analyzed.analysisWords,
      clipped: analyzed.clipped,
      summary: this.getDataString(row.data, 'summary')
    };
  }

  async analyzeHistory(opts: {
    workspaceId: string;
    sessionId: string;
    question: string;
    fromMessageId?: string | null;
    toMessageId?: string | null;
    maxTurns?: number | null;
    targetToolCallId?: string | null;
    targetToolResultMessageId?: string | null;
    includeToolResults?: boolean;
    includeSystemMessages?: boolean;
    maxWords?: number | null;
    signal?: AbortSignal;
  }): Promise<{
    answer: string;
    evidence: Array<{ messageId: string; role: string; sequence: number }>;
    coverage: {
      scannedTurns: number;
      totalTurns: number;
      chunked: boolean;
      chunkCount: number;
      truncated: boolean;
      insufficientCoverage: boolean;
    };
    confidence: 'low' | 'medium' | 'high';
  }> {
    const question = (opts.question || '').trim();
    if (!question) throw new Error('history_analyze: question is required');
    const maxWords = Math.max(200, Math.min(6_000, Math.floor(opts.maxWords ?? 1_500)));

    const [session] = await db
      .select({
        id: chatSessions.id,
        workspaceId: chatSessions.workspaceId,
      })
      .from(chatSessions)
      .where(eq(chatSessions.id, opts.sessionId))
      .limit(1);

    if (!session) throw new Error('history_analyze: session not found');
    if (!session.workspaceId || session.workspaceId !== opts.workspaceId) {
      throw new Error('Security: history_analyze session does not match workspace');
    }

    const allMessages = await db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        content: chatMessages.content,
        sequence: chatMessages.sequence,
        toolCallId: chatMessages.toolCallId,
      })
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, opts.sessionId))
      .orderBy(asc(chatMessages.sequence));

    const fromMessageId =
      typeof opts.fromMessageId === 'string' ? opts.fromMessageId.trim() : '';
    const toMessageId =
      typeof opts.toMessageId === 'string' ? opts.toMessageId.trim() : '';
    const fromSequence =
      fromMessageId.length > 0
        ? allMessages.find((msg) => msg.id === fromMessageId)?.sequence ?? null
        : null;
    const toSequence =
      toMessageId.length > 0
        ? allMessages.find((msg) => msg.id === toMessageId)?.sequence ?? null
        : null;
    if (fromMessageId && fromSequence == null) {
      throw new Error('history_analyze: from_message_id not found in session');
    }
    if (toMessageId && toSequence == null) {
      throw new Error('history_analyze: to_message_id not found in session');
    }

    const includeToolResults = opts.includeToolResults !== false;
    const includeSystemMessages = opts.includeSystemMessages === true;
    const maxTurns =
      typeof opts.maxTurns === 'number' && Number.isFinite(opts.maxTurns)
        ? Math.max(1, Math.min(500, Math.floor(opts.maxTurns)))
        : 80;

    let selected = allMessages.filter((message) => {
      if (fromSequence != null && message.sequence < fromSequence) return false;
      if (toSequence != null && message.sequence > toSequence) return false;
      if (message.role === 'tool' && !includeToolResults) return false;
      if (message.role === 'system' && !includeSystemMessages) return false;
      return message.role === 'user' || message.role === 'assistant' || message.role === 'tool' || message.role === 'system';
    });

    const targetToolCallId =
      typeof opts.targetToolCallId === 'string' ? opts.targetToolCallId.trim() : '';
    const targetToolResultMessageId =
      typeof opts.targetToolResultMessageId === 'string'
        ? opts.targetToolResultMessageId.trim()
        : '';
    if (targetToolCallId || targetToolResultMessageId) {
      let targetSequence: number | null = null;
      if (targetToolResultMessageId) {
        targetSequence =
          allMessages.find((msg) => msg.id === targetToolResultMessageId)?.sequence ??
          null;
      } else if (targetToolCallId) {
        targetSequence =
          allMessages.find(
            (msg) => msg.role === 'tool' && msg.toolCallId === targetToolCallId,
          )?.sequence ?? null;
      }
      if (targetSequence != null) {
        selected = selected.filter(
          (message) =>
            message.sequence >= targetSequence - 6 &&
            message.sequence <= targetSequence + 6,
        );
      }
    }

    let truncated = false;
    if (selected.length > maxTurns) {
      selected = selected.slice(-maxTurns);
      truncated = true;
    }

    const evidence = selected.map((message) => ({
      messageId: message.id,
      role: message.role,
      sequence: message.sequence,
    }));

    const historyText = selected
      .map((message) => {
        const body = (message.content || '').trim();
        const normalized =
          body.length > 3_500 ? `${body.slice(0, 3_500)}\n...(truncated)...` : body;
        return [
          `message_id=${message.id}`,
          `sequence=${message.sequence}`,
          `role=${message.role}`,
          normalized || '(empty)',
        ].join('\n');
      })
      .join('\n\n---\n\n');

    if (!historyText.trim()) {
      return {
        answer: 'insufficient_coverage',
        evidence: [],
        coverage: {
          scannedTurns: 0,
          totalTurns: allMessages.length,
          chunked: false,
          chunkCount: 0,
          truncated,
          insufficientCoverage: true,
        },
        confidence: 'low',
      };
    }

    const analyzed = await this.runChunkedPromptAnalysis({
      model: 'gpt-4.1-nano',
      text: historyText,
      instruction: question,
      maxWords,
      perChunkMaxWords: 900,
      singlePassTokenLimit: 240_000,
      chunkTargetTokens: 120_000,
      analysisPromptId: 'history_analyze',
      mergePromptId: 'history_analyze_merge',
      templateVars: {
        lang: 'français',
        session_id: opts.sessionId,
        total_turns: String(allMessages.length),
      },
      textVarName: 'history_text',
      scopeVarName: 'scope',
      instructionVarName: 'question',
      notesVarName: 'notes',
      signal: opts.signal,
    });

    return {
      answer: analyzed.analysis,
      evidence,
      coverage: {
        scannedTurns: selected.length,
        totalTurns: allMessages.length,
        chunked: analyzed.chunked,
        chunkCount: analyzed.chunkCount,
        truncated,
        insufficientCoverage: false,
      },
      confidence:
        selected.length <= 2 || truncated
          ? 'low'
          : analyzed.chunked
            ? 'medium'
            : 'high',
    };
  }
  // ---------------------------
  // Extended objects (solutions, products, bids)
  // ---------------------------

  async listSolutions(opts: { initiativeId: string; workspaceId: string; select?: string[] | null }) {
    const rows = await db.select().from(solutions)
      .where(and(eq(solutions.initiativeId, opts.initiativeId), eq(solutions.workspaceId, opts.workspaceId)));
    const select = Array.isArray(opts.select) ? opts.select.filter(Boolean) : null;
    const items = rows.map((r) => {
      const obj: Record<string, unknown> = { id: r.id, status: r.status, version: r.version, ...(r.data as Record<string, unknown> ?? {}) };
      return select ? pickObjectFields(obj, select) : obj;
    });
    return { items, count: rows.length };
  }

  async getSolution(solutionId: string, opts?: { workspaceId?: string; select?: string[] | null }) {
    if (!solutionId) throw new Error('solutionId is required');
    const where = opts?.workspaceId
      ? and(eq(solutions.id, solutionId), eq(solutions.workspaceId, opts.workspaceId))
      : eq(solutions.id, solutionId);
    const [row] = await db.select().from(solutions).where(where).limit(1);
    if (!row) throw new Error('Solution not found');
    const select = Array.isArray(opts?.select) ? opts?.select.filter(Boolean) : null;
    const obj: Record<string, unknown> = { id: row.id, status: row.status, version: row.version, ...(row.data as Record<string, unknown> ?? {}) };
    return { solutionId, data: select ? pickObjectFields(obj, select) : obj };
  }

  async listBids(opts: { initiativeId: string; workspaceId: string; select?: string[] | null }) {
    const rows = await db.select().from(bids)
      .where(and(eq(bids.initiativeId, opts.initiativeId), eq(bids.workspaceId, opts.workspaceId)));
    const select = Array.isArray(opts.select) ? opts.select.filter(Boolean) : null;
    const items = rows.map((r) => {
      const obj: Record<string, unknown> = { id: r.id, status: r.status, version: r.version, ...(r.data as Record<string, unknown> ?? {}) };
      return select ? pickObjectFields(obj, select) : obj;
    });
    return { items, count: rows.length };
  }

  async getBid(bidId: string, opts?: { workspaceId?: string; select?: string[] | null }) {
    if (!bidId) throw new Error('bidId is required');
    const where = opts?.workspaceId
      ? and(eq(bids.id, bidId), eq(bids.workspaceId, opts.workspaceId))
      : eq(bids.id, bidId);
    const [row] = await db.select().from(bids).where(where).limit(1);
    if (!row) throw new Error('Bid not found');
    const select = Array.isArray(opts?.select) ? opts?.select.filter(Boolean) : null;
    const obj: Record<string, unknown> = { id: row.id, status: row.status, version: row.version, ...(row.data as Record<string, unknown> ?? {}) };
    return { bidId, data: select ? pickObjectFields(obj, select) : obj };
  }

  async listProducts(opts: { workspaceId: string; initiativeId?: string; select?: string[] | null }) {
    const conditions = [eq(products.workspaceId, opts.workspaceId)];
    if (opts.initiativeId) conditions.push(eq(products.initiativeId, opts.initiativeId));
    const rows = await db.select().from(products).where(and(...conditions));
    const select = Array.isArray(opts.select) ? opts.select.filter(Boolean) : null;
    const items = rows.map((r) => {
      const obj: Record<string, unknown> = { id: r.id, status: r.status, version: r.version, solutionId: r.solutionId, ...(r.data as Record<string, unknown> ?? {}) };
      return select ? pickObjectFields(obj, select) : obj;
    });
    return { items, count: rows.length };
  }

  async getProduct(productId: string, opts?: { workspaceId?: string; select?: string[] | null }) {
    if (!productId) throw new Error('productId is required');
    const where = opts?.workspaceId
      ? and(eq(products.id, productId), eq(products.workspaceId, opts.workspaceId))
      : eq(products.id, productId);
    const [row] = await db.select().from(products).where(where).limit(1);
    if (!row) throw new Error('Product not found');
    const select = Array.isArray(opts?.select) ? opts?.select.filter(Boolean) : null;
    const obj: Record<string, unknown> = { id: row.id, status: row.status, version: row.version, solutionId: row.solutionId, ...(row.data as Record<string, unknown> ?? {}) };
    return { productId, data: select ? pickObjectFields(obj, select) : obj };
  }

  async reviewGate(workspaceId: string, initiativeId: string, targetStage: string) {
    return evaluateGate(workspaceId, initiativeId, targetStage);
  }

  // ---------------------------
  // Cross-workspace tools (neutral)
  // ---------------------------

  async listWorkspacesForUser(userId: string) {
    const memberships = await db.select({ workspaceId: workspaceMemberships.workspaceId, role: workspaceMemberships.role })
      .from(workspaceMemberships).where(eq(workspaceMemberships.userId, userId));
    if (memberships.length === 0) return { items: [], count: 0 };
    const wsIds = memberships.map((m) => m.workspaceId);
    const wsRows = await db.select().from(workspaces).where(inArray(workspaces.id, wsIds));
    const roleMap = new Map(memberships.map((m) => [m.workspaceId, m.role]));
    const items = wsRows.map((ws) => ({
      id: ws.id, name: ws.name, type: ws.type, role: roleMap.get(ws.id) ?? 'viewer',
    }));
    return { items, count: items.length };
  }

  async searchInitiativesCrossWorkspace(userId: string, opts?: { query?: string; status?: string; maturityStage?: string }) {
    const memberships = await db.select({ workspaceId: workspaceMemberships.workspaceId })
      .from(workspaceMemberships).where(eq(workspaceMemberships.userId, userId));
    if (memberships.length === 0) return { items: [], count: 0 };
    const wsIds = memberships.map((m) => m.workspaceId);
    const conditions = [inArray(initiatives.workspaceId, wsIds)];
    if (opts?.status) conditions.push(eq(initiatives.status, opts.status));
    const rows = await db.select().from(initiatives).where(and(...conditions));
    let filtered = rows;
    if (opts?.query) {
      const q = opts.query.toLowerCase();
      filtered = rows.filter((r) => {
        const d = (r.data ?? {}) as Record<string, unknown>;
        const name = typeof d.name === 'string' ? d.name : '';
        const desc = typeof d.description === 'string' ? d.description : '';
        return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
      });
    }
    if (opts?.maturityStage) {
      filtered = filtered.filter((r) => r.maturityStage === opts.maturityStage);
    }
    const items = filtered.map((r) => {
      const d = (r.data ?? {}) as Record<string, unknown>;
      return { id: r.id, name: d.name ?? null, status: r.status, workspaceId: r.workspaceId, folderId: r.folderId };
    });
    return { items, count: items.length };
  }
}

export const toolService = new ToolService();
