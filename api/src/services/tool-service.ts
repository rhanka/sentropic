import { and, eq, sql } from 'drizzle-orm';
import { db, pool } from '../db/client';
import { chatContexts, contextModificationHistory, useCases } from '../db/schema';
import { createId } from '../utils/id';

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

function coerceMarkdownList(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map((v) => {
      if (typeof v === 'string') return v;
      if (v && typeof v === 'object' && 'key' in (v as any)) return String((v as any).key ?? '');
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

export class ToolService {
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

    const data = (row.data ?? {}) as any;
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
}

export const toolService = new ToolService();


