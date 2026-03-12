import { db } from '../db/client';
import { solutions, initiatives } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../utils/id';
import type { SolutionRow } from '../db/schema';

export interface CreateSolutionInput {
  initiativeId: string;
  status?: string;
  data?: Record<string, unknown>;
}

export interface UpdateSolutionInput {
  status?: string;
  data?: Record<string, unknown>;
}

/**
 * Verify initiative exists and belongs to workspace.
 */
async function verifyInitiativeOwnership(initiativeId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

export const solutionService = {
  async list(workspaceId: string, initiativeId?: string): Promise<SolutionRow[]> {
    if (initiativeId) {
      return db
        .select()
        .from(solutions)
        .where(and(eq(solutions.workspaceId, workspaceId), eq(solutions.initiativeId, initiativeId)));
    }
    return db.select().from(solutions).where(eq(solutions.workspaceId, workspaceId));
  },

  async getById(id: string, workspaceId: string): Promise<SolutionRow | null> {
    const [row] = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    return row ?? null;
  },

  async create(workspaceId: string, input: CreateSolutionInput): Promise<SolutionRow> {
    const exists = await verifyInitiativeOwnership(input.initiativeId, workspaceId);
    if (!exists) throw new Error('Initiative not found in workspace');

    const id = createId();
    await db.insert(solutions).values({
      id,
      workspaceId,
      initiativeId: input.initiativeId,
      status: input.status ?? 'draft',
      data: input.data ?? {},
    });
    const [row] = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    return row;
  },

  async update(id: string, workspaceId: string, input: UpdateSolutionInput): Promise<SolutionRow | null> {
    const [existing] = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.data !== undefined) updates.data = input.data;

    await db
      .update(solutions)
      .set(updates)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));

    const [row] = await db
      .select()
      .from(solutions)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    return row;
  },

  async remove(id: string, workspaceId: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: solutions.id })
      .from(solutions)
      .where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    if (!existing) return false;

    await db.delete(solutions).where(and(eq(solutions.id, id), eq(solutions.workspaceId, workspaceId)));
    return true;
  },
};
