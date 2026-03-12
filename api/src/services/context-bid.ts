import { db } from '../db/client';
import { bids, bidProducts, initiatives, products } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../utils/id';
import type { BidRow, BidProductRow } from '../db/schema';

export interface CreateBidInput {
  initiativeId: string;
  status?: string;
  data?: Record<string, unknown>;
}

export interface UpdateBidInput {
  status?: string;
  data?: Record<string, unknown>;
}

export interface AttachProductInput {
  productId: string;
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

export const bidService = {
  async list(workspaceId: string, initiativeId?: string): Promise<BidRow[]> {
    if (initiativeId) {
      return db
        .select()
        .from(bids)
        .where(and(eq(bids.workspaceId, workspaceId), eq(bids.initiativeId, initiativeId)));
    }
    return db.select().from(bids).where(eq(bids.workspaceId, workspaceId));
  },

  async getById(id: string, workspaceId: string): Promise<BidRow | null> {
    const [row] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return row ?? null;
  },

  async create(workspaceId: string, input: CreateBidInput): Promise<BidRow> {
    const exists = await verifyInitiativeOwnership(input.initiativeId, workspaceId);
    if (!exists) throw new Error('Initiative not found in workspace');

    const id = createId();
    await db.insert(bids).values({
      id,
      workspaceId,
      initiativeId: input.initiativeId,
      status: input.status ?? 'draft',
      data: input.data ?? {},
    });
    const [row] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return row;
  },

  async update(id: string, workspaceId: string, input: UpdateBidInput): Promise<BidRow | null> {
    const [existing] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    if (!existing) return null;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status !== undefined) updates.status = input.status;
    if (input.data !== undefined) updates.data = input.data;

    await db
      .update(bids)
      .set(updates)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));

    const [row] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return row;
  },

  async remove(id: string, workspaceId: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: bids.id })
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    if (!existing) return false;

    // Delete junction records first (cascade)
    await db.delete(bidProducts).where(eq(bidProducts.bidId, id));
    await db.delete(bids).where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return true;
  },

  // --- bid_products junction ---

  async listProducts(bidId: string, workspaceId: string): Promise<BidProductRow[]> {
    // Verify bid belongs to workspace
    const bid = await this.getById(bidId, workspaceId);
    if (!bid) throw new Error('Bid not found in workspace');

    return db.select().from(bidProducts).where(eq(bidProducts.bidId, bidId));
  },

  async attachProduct(bidId: string, workspaceId: string, input: AttachProductInput): Promise<BidProductRow> {
    // Verify bid belongs to workspace
    const bid = await this.getById(bidId, workspaceId);
    if (!bid) throw new Error('Bid not found in workspace');

    // Verify product belongs to workspace
    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.workspaceId, workspaceId)))
      .limit(1);
    if (!product) throw new Error('Product not found in workspace');

    const id = createId();
    await db.insert(bidProducts).values({
      id,
      bidId,
      productId: input.productId,
      data: input.data ?? {},
    });

    const [row] = await db.select().from(bidProducts).where(eq(bidProducts.id, id));
    return row;
  },

  async detachProduct(bidId: string, productId: string, workspaceId: string): Promise<boolean> {
    // Verify bid belongs to workspace
    const bid = await this.getById(bidId, workspaceId);
    if (!bid) return false;

    const [existing] = await db
      .select({ id: bidProducts.id })
      .from(bidProducts)
      .where(and(eq(bidProducts.bidId, bidId), eq(bidProducts.productId, productId)))
      .limit(1);
    if (!existing) return false;

    await db
      .delete(bidProducts)
      .where(and(eq(bidProducts.bidId, bidId), eq(bidProducts.productId, productId)));
    return true;
  },
};
