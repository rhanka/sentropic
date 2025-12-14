import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
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

function setAtPath(root: unknown, segments: string[], value: unknown): unknown {
  if (segments.length === 0) return value;
  const [head, ...tail] = segments;
  const idx = Number(head);

  // array index
  if (Number.isInteger(idx)) {
    const arr = Array.isArray(root) ? [...root] : [];
    const current = arr[idx];
    arr[idx] = tail.length === 0 ? value : setAtPath(current, tail, value);
    return arr;
  }

  const obj = (root && typeof root === 'object' && !Array.isArray(root)) ? ({ ...(root as Record<string, unknown>) }) : {};
  const current = (obj as Record<string, unknown>)[head];
  (obj as Record<string, unknown>)[head] = tail.length === 0 ? value : setAtPath(current, tail, value);
  return obj;
}

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
   * Tool générique: met à jour un ou plusieurs champs d’un use case.
   * Cible principale: `use_cases.data.*` (JSONB).
   */
  async updateUseCaseFields(input: UpdateUseCaseFieldsInput): Promise<{
    useCaseId: string;
    applied: Array<{ path: string; oldValue: unknown; newValue: unknown }>;
  }> {
    if (!input.useCaseId) throw new Error('useCaseId is required');
    if (!Array.isArray(input.updates) || input.updates.length === 0) throw new Error('updates is required');
    if (input.updates.length > 50) throw new Error('Too many updates (max 50)');

    const [row] = await db.select().from(useCases).where(eq(useCases.id, input.useCaseId));
    if (!row) throw new Error('Use case not found');

    // `use_cases.data` est directement l'objet métier (pas de wrapper "data")
    const originalData = (row.data ?? {}) as unknown;
    const beforeData = deepClone(originalData) as unknown;
    let nextData = deepClone(originalData) as unknown;

    const applied: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];

    for (const u of input.updates) {
      const fullPath = normalizeDataPath(u.path);
      const segments = getPathSegments(fullPath);
      if (segments[0] !== 'data') throw new Error('Only data.* paths are supported');

      const dataSegments = segments.slice(1);
      if (dataSegments.length === 0) throw new Error('Refusing to overwrite entire data object');

      const oldValue = getAtPath(nextData, dataSegments);
      nextData = setAtPath(nextData, dataSegments, u.value);
      const newValue = getAtPath(nextData, dataSegments);

      applied.push({ path: fullPath, oldValue, newValue });
    }

    // En DB: on met à jour use_cases.data
    const finalData = nextData;
    await db.update(useCases).set({ data: finalData as unknown }).where(eq(useCases.id, input.useCaseId));

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
}

export const toolService = new ToolService();


