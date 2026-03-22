import { db } from '../db/client';
import { products, initiatives, solutions } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../utils/id';
import type { ProductRow } from '../db/schema';

export interface CreateProductInput {
  initiativeId: string;
  solutionId?: string;
  status?: string;
  data?: Record<string, unknown>;
}

export interface UpdateProductInput {
  status?: string;
  solutionId?: string | null;
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

/**
 * Verify solution exists and belongs to workspace.
 */
async function verifySolutionOwnership(solutionId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: solutions.id })
    .from(solutions)
    .where(and(eq(solutions.id, solutionId), eq(solutions.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

export const productService = {
  async list(workspaceId: string, filters?: { initiativeId?: string; solutionId?: string }): Promise<ProductRow[]> {
    if (filters?.solutionId) {
      return db
        .select()
        .from(products)
        .where(and(eq(products.workspaceId, workspaceId), eq(products.solutionId, filters.solutionId)));
    }
    if (filters?.initiativeId) {
      return db
        .select()
        .from(products)
        .where(and(eq(products.workspaceId, workspaceId), eq(products.initiativeId, filters.initiativeId)));
    }
    return db.select().from(products).where(eq(products.workspaceId, workspaceId));
  },

  async getById(id: string, workspaceId: string): Promise<ProductRow | null> {
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    return row ?? null;
  },

  async create(workspaceId: string, input: CreateProductInput): Promise<ProductRow> {
    const exists = await verifyInitiativeOwnership(input.initiativeId, workspaceId);
    if (!exists) throw new Error('Initiative not found in workspace');

    if (input.solutionId) {
      const solExists = await verifySolutionOwnership(input.solutionId, workspaceId);
      if (!solExists) throw new Error('Solution not found in workspace');
    }

    const id = createId();
    await db.insert(products).values({
      id,
      workspaceId,
      initiativeId: input.initiativeId,
      solutionId: input.solutionId ?? null,
      status: input.status ?? 'draft',
      data: input.data ?? {},
    });
    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    return row;
  },

  async update(id: string, workspaceId: string, input: UpdateProductInput): Promise<ProductRow | null> {
    const [existing] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    if (!existing) return null;

    if (input.solutionId) {
      const solExists = await verifySolutionOwnership(input.solutionId, workspaceId);
      if (!solExists) throw new Error('Solution not found in workspace');
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.solutionId !== undefined) updates.solutionId = input.solutionId;
    if (input.data !== undefined) updates.data = input.data;

    await db
      .update(products)
      .set(updates)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));

    const [row] = await db
      .select()
      .from(products)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    return row;
  },

  async remove(id: string, workspaceId: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    if (!existing) return false;

    await db.delete(products).where(and(eq(products.id, id), eq(products.workspaceId, workspaceId)));
    return true;
  },
};
