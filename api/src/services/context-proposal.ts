/**
 * Proposal service — renamed from context-bid.ts.
 * Uses the underlying `bids` and `bid_products` SQL tables for backward compat.
 */
import { db } from '../db/client';
import { bids, bidProducts, initiatives, products } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { createId } from '../utils/id';
import type { BidRow, BidProductRow } from '../db/schema';

// Re-export types with new names
export type ProposalRow = BidRow;
export type ProposalProductRow = BidProductRow;

export interface CreateProposalInput {
  initiativeId: string;
  status?: string;
  data?: Record<string, unknown>;
}

export interface UpdateProposalInput {
  status?: string;
  data?: Record<string, unknown>;
}

export interface AttachProductInput {
  productId: string;
  data?: Record<string, unknown>;
}

async function verifyInitiativeOwnership(initiativeId: string, workspaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: initiatives.id })
    .from(initiatives)
    .where(and(eq(initiatives.id, initiativeId), eq(initiatives.workspaceId, workspaceId)))
    .limit(1);
  return !!row;
}

export const proposalService = {
  async list(workspaceId: string, initiativeId?: string): Promise<ProposalRow[]> {
    if (initiativeId) {
      return db
        .select()
        .from(bids)
        .where(and(eq(bids.workspaceId, workspaceId), eq(bids.initiativeId, initiativeId)));
    }
    return db.select().from(bids).where(eq(bids.workspaceId, workspaceId));
  },

  async getById(id: string, workspaceId: string): Promise<ProposalRow | null> {
    const [row] = await db
      .select()
      .from(bids)
      .where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return row ?? null;
  },

  async create(workspaceId: string, input: CreateProposalInput): Promise<ProposalRow> {
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

  async update(id: string, workspaceId: string, input: UpdateProposalInput): Promise<ProposalRow | null> {
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

    await db.delete(bidProducts).where(eq(bidProducts.bidId, id));
    await db.delete(bids).where(and(eq(bids.id, id), eq(bids.workspaceId, workspaceId)));
    return true;
  },

  async listProducts(proposalId: string, workspaceId: string): Promise<ProposalProductRow[]> {
    const proposal = await this.getById(proposalId, workspaceId);
    if (!proposal) throw new Error('Proposal not found in workspace');
    return db.select().from(bidProducts).where(eq(bidProducts.bidId, proposalId));
  },

  async attachProduct(proposalId: string, workspaceId: string, input: AttachProductInput): Promise<ProposalProductRow> {
    const proposal = await this.getById(proposalId, workspaceId);
    if (!proposal) throw new Error('Proposal not found in workspace');

    const [product] = await db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.workspaceId, workspaceId)))
      .limit(1);
    if (!product) throw new Error('Product not found in workspace');

    const id = createId();
    await db.insert(bidProducts).values({
      id,
      bidId: proposalId,
      productId: input.productId,
      data: input.data ?? {},
    });

    const [row] = await db.select().from(bidProducts).where(eq(bidProducts.id, id));
    return row;
  },

  async detachProduct(proposalId: string, productId: string, workspaceId: string): Promise<boolean> {
    const proposal = await this.getById(proposalId, workspaceId);
    if (!proposal) return false;

    const [existing] = await db
      .select({ id: bidProducts.id })
      .from(bidProducts)
      .where(and(eq(bidProducts.bidId, proposalId), eq(bidProducts.productId, productId)))
      .limit(1);
    if (!existing) return false;

    await db
      .delete(bidProducts)
      .where(and(eq(bidProducts.bidId, proposalId), eq(bidProducts.productId, productId)));
    return true;
  },
};

// Backward compat: re-export as bidService
export const bidService = proposalService;
