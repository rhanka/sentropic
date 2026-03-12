import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { authenticatedRequest, cleanupAuthData, createAuthenticatedUser } from '../utils/auth-helper';
import { db } from '../../src/db/client';
import {
  workspaces,
  workspaceMemberships,
  folders,
  initiatives,
  solutions,
  products,
  bids,
  bidProducts,
} from '../../src/db/schema';
import { eq } from 'drizzle-orm';

async function importApp() {
  const mod = await import('../../src/app');
  return mod.app as any;
}

describe('Extended objects API (solutions, products, bids)', () => {
  let app: any;
  let editor: any;
  let viewer: any;
  const cleanupIds = {
    workspaceIds: [] as string[],
    folderIds: [] as string[],
    initiativeIds: [] as string[],
    solutionIds: [] as string[],
    productIds: [] as string[],
    bidIds: [] as string[],
  };

  let testFolderId: string;
  let testInitiativeId: string;

  beforeEach(async () => {
    app = await importApp();
    editor = await createAuthenticatedUser('editor', `editor-eo-${Date.now()}@example.com`);
    viewer = await createAuthenticatedUser('guest', `viewer-eo-${Date.now()}@example.com`);
    if (editor.workspaceId) cleanupIds.workspaceIds.push(editor.workspaceId);
    if (viewer.workspaceId) cleanupIds.workspaceIds.push(viewer.workspaceId);

    // Create a folder and initiative for the editor's workspace
    testFolderId = crypto.randomUUID();
    await db.insert(folders).values({
      id: testFolderId,
      workspaceId: editor.workspaceId!,
      name: 'Test Folder',
      status: 'completed',
    });
    cleanupIds.folderIds.push(testFolderId);

    testInitiativeId = crypto.randomUUID();
    await db.insert(initiatives).values({
      id: testInitiativeId,
      workspaceId: editor.workspaceId!,
      folderId: testFolderId,
      data: { name: 'Test Initiative' },
    });
    cleanupIds.initiativeIds.push(testInitiativeId);
  });

  afterEach(async () => {
    // Cleanup in reverse dependency order
    for (const id of cleanupIds.bidIds) {
      await db.delete(bidProducts).where(eq(bidProducts.bidId, id));
      await db.delete(bids).where(eq(bids.id, id));
    }
    for (const id of cleanupIds.productIds) {
      await db.delete(products).where(eq(products.id, id));
    }
    for (const id of cleanupIds.solutionIds) {
      await db.delete(solutions).where(eq(solutions.id, id));
    }
    for (const id of cleanupIds.initiativeIds) {
      await db.delete(initiatives).where(eq(initiatives.id, id));
    }
    for (const id of cleanupIds.folderIds) {
      await db.delete(folders).where(eq(folders.id, id));
    }
    for (const id of cleanupIds.workspaceIds) {
      await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    Object.values(cleanupIds).forEach(arr => (arr.length = 0));
    await cleanupAuthData();
  });

  // ========== Solutions ==========

  describe('Solutions CRUD', () => {
    it('creates a solution for an initiative', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
        data: { description: 'A test solution' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBeDefined();
      expect(json.initiativeId).toBe(testInitiativeId);
      expect(json.status).toBe('draft');
      cleanupIds.solutionIds.push(json.id);
    });

    it('lists solutions filtered by initiative_id', async () => {
      // Create a solution first
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
        data: { description: 'Solution for list' },
      });
      const { id } = await createRes.json();
      cleanupIds.solutionIds.push(id);

      const listRes = await authenticatedRequest(
        app, 'GET', `/api/v1/solutions?initiative_id=${testInitiativeId}`, editor.sessionToken
      );
      expect(listRes.status).toBe(200);
      const { items } = await listRes.json();
      expect(items.length).toBeGreaterThanOrEqual(1);
      expect(items.some((s: any) => s.id === id)).toBe(true);
    });

    it('gets a solution by ID', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();
      cleanupIds.solutionIds.push(id);

      const getRes = await authenticatedRequest(app, 'GET', `/api/v1/solutions/${id}`, editor.sessionToken);
      expect(getRes.status).toBe(200);
      const json = await getRes.json();
      expect(json.id).toBe(id);
    });

    it('updates a solution', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();
      cleanupIds.solutionIds.push(id);

      const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/solutions/${id}`, editor.sessionToken, {
        status: 'validated',
        data: { description: 'Updated solution' },
      });
      expect(updateRes.status).toBe(200);
      const json = await updateRes.json();
      expect(json.status).toBe('validated');
    });

    it('deletes a solution', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();

      const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/solutions/${id}`, editor.sessionToken);
      expect(deleteRes.status).toBe(204);

      const getRes = await authenticatedRequest(app, 'GET', `/api/v1/solutions/${id}`, editor.sessionToken);
      expect(getRes.status).toBe(404);
    });

    it('returns 404 for non-existent solution', async () => {
      const res = await authenticatedRequest(app, 'GET', `/api/v1/solutions/${crypto.randomUUID()}`, editor.sessionToken);
      expect(res.status).toBe(404);
    });
  });

  // ========== Products ==========

  describe('Products CRUD', () => {
    it('creates a product for an initiative', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
        data: { name: 'Test product' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBeDefined();
      expect(json.status).toBe('draft');
      cleanupIds.productIds.push(json.id);
    });

    it('creates a product linked to a solution', async () => {
      // Create solution first
      const solRes = await authenticatedRequest(app, 'POST', '/api/v1/solutions', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const sol = await solRes.json();
      cleanupIds.solutionIds.push(sol.id);

      const res = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
        solutionId: sol.id,
        data: { name: 'Product linked to solution' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.solutionId).toBe(sol.id);
      cleanupIds.productIds.push(json.id);
    });

    it('lists products by initiative_id', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();
      cleanupIds.productIds.push(id);

      const listRes = await authenticatedRequest(
        app, 'GET', `/api/v1/products?initiative_id=${testInitiativeId}`, editor.sessionToken
      );
      expect(listRes.status).toBe(200);
      const { items } = await listRes.json();
      expect(items.some((p: any) => p.id === id)).toBe(true);
    });

    it('updates a product status', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();
      cleanupIds.productIds.push(id);

      const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/products/${id}`, editor.sessionToken, {
        status: 'active',
      });
      expect(updateRes.status).toBe(200);
      const json = await updateRes.json();
      expect(json.status).toBe('active');
    });

    it('deletes a product', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();

      const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/products/${id}`, editor.sessionToken);
      expect(deleteRes.status).toBe(204);
    });
  });

  // ========== Bids ==========

  describe('Bids CRUD', () => {
    it('creates a bid for an initiative', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/bids', editor.sessionToken, {
        initiativeId: testInitiativeId,
        data: { title: 'Test bid' },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.id).toBeDefined();
      expect(json.status).toBe('draft');
      cleanupIds.bidIds.push(json.id);
    });

    it('updates a bid', async () => {
      const createRes = await authenticatedRequest(app, 'POST', '/api/v1/bids', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const { id } = await createRes.json();
      cleanupIds.bidIds.push(id);

      const updateRes = await authenticatedRequest(app, 'PUT', `/api/v1/bids/${id}`, editor.sessionToken, {
        status: 'review',
        data: { title: 'Updated bid' },
      });
      expect(updateRes.status).toBe(200);
      const json = await updateRes.json();
      expect(json.status).toBe('review');
    });

    it('deletes a bid and cascades to bid_products', async () => {
      // Create bid + product + attach
      const bidRes = await authenticatedRequest(app, 'POST', '/api/v1/bids', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const bid = await bidRes.json();

      const prodRes = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const prod = await prodRes.json();
      cleanupIds.productIds.push(prod.id);

      await authenticatedRequest(app, 'POST', `/api/v1/bids/${bid.id}/products`, editor.sessionToken, {
        productId: prod.id,
      });

      // Delete bid should succeed (cascade removes bid_products)
      const deleteRes = await authenticatedRequest(app, 'DELETE', `/api/v1/bids/${bid.id}`, editor.sessionToken);
      expect(deleteRes.status).toBe(204);

      // Verify bid is gone
      const getRes = await authenticatedRequest(app, 'GET', `/api/v1/bids/${bid.id}`, editor.sessionToken);
      expect(getRes.status).toBe(404);
    });
  });

  // ========== Bid-Products Junction ==========

  describe('Bid-Products junction', () => {
    let bidId: string;
    let productId: string;

    beforeEach(async () => {
      const bidRes = await authenticatedRequest(app, 'POST', '/api/v1/bids', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const bid = await bidRes.json();
      bidId = bid.id;
      cleanupIds.bidIds.push(bidId);

      const prodRes = await authenticatedRequest(app, 'POST', '/api/v1/products', editor.sessionToken, {
        initiativeId: testInitiativeId,
      });
      const prod = await prodRes.json();
      productId = prod.id;
      cleanupIds.productIds.push(productId);
    });

    it('attaches a product to a bid', async () => {
      const res = await authenticatedRequest(app, 'POST', `/api/v1/bids/${bidId}/products`, editor.sessionToken, {
        productId,
        data: { unitPrice: 1000 },
      });
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.bidId).toBe(bidId);
      expect(json.productId).toBe(productId);
    });

    it('lists products attached to a bid', async () => {
      await authenticatedRequest(app, 'POST', `/api/v1/bids/${bidId}/products`, editor.sessionToken, {
        productId,
      });

      const listRes = await authenticatedRequest(app, 'GET', `/api/v1/bids/${bidId}/products`, editor.sessionToken);
      expect(listRes.status).toBe(200);
      const { items } = await listRes.json();
      expect(items.length).toBe(1);
      expect(items[0].productId).toBe(productId);
    });

    it('detaches a product from a bid', async () => {
      await authenticatedRequest(app, 'POST', `/api/v1/bids/${bidId}/products`, editor.sessionToken, {
        productId,
      });

      const deleteRes = await authenticatedRequest(
        app, 'DELETE', `/api/v1/bids/${bidId}/products/${productId}`, editor.sessionToken
      );
      expect(deleteRes.status).toBe(204);

      // Verify detached
      const listRes = await authenticatedRequest(app, 'GET', `/api/v1/bids/${bidId}/products`, editor.sessionToken);
      const { items } = await listRes.json();
      expect(items.length).toBe(0);
    });
  });

  // ========== Access Control ==========

  describe('Access control', () => {
    it('denies solution creation for viewer (guest role)', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/solutions', viewer.sessionToken, {
        initiativeId: testInitiativeId,
      });
      // Guest role should be rejected by requireEditor middleware
      expect(res.status).toBe(403);
    });

    it('denies product creation for viewer', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/products', viewer.sessionToken, {
        initiativeId: testInitiativeId,
      });
      expect(res.status).toBe(403);
    });

    it('denies bid creation for viewer', async () => {
      const res = await authenticatedRequest(app, 'POST', '/api/v1/bids', viewer.sessionToken, {
        initiativeId: testInitiativeId,
      });
      expect(res.status).toBe(403);
    });
  });
});
