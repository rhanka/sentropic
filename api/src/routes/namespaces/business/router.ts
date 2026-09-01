import { Hono } from 'hono';

import { createBidsBusinessRouter } from './bids';
import { createFoldersBusinessRouter } from './folders';
import { createInitiativesBusinessRouter } from './initiatives';
import { createOrganizationsBusinessRouter } from './organizations';
import type { BusinessNamespacePorts } from './ports';
import { createProductsBusinessRouter } from './products';
import { createProposalsBusinessRouter } from './proposals';
import { createSolutionsBusinessRouter } from './solutions';
import { createViewTemplatesBusinessRouter } from './view-templates';

export const BUSINESS_PATHS = [
  '/organizations',
  '/organizations/draft',
  '/organizations/:id/enrich',
  '/organizations/:id',
  '/organizations/ai-enrich',
  '/folders',
  '/folders/draft',
  '/folders/:id',
  '/folders/:id/matrix',
  '/folders/matrix/default',
  '/folders/list/with-matrices',
  '/initiatives',
  '/initiatives/:id',
  '/initiatives/generate',
  '/initiatives/:id/detail',
  '/use-cases',
  '/use-cases/:id',
  '/use-cases/generate',
  '/use-cases/:id/detail',
  '/solutions',
  '/solutions/:id',
  '/products',
  '/products/:id',
  '/proposals',
  '/proposals/:id',
  '/proposals/:id/products',
  '/proposals/:id/products/:productId',
  '/bids',
  '/bids/:id',
  '/bids/:id/products',
  '/bids/:id/products/:productId',
  '/view-templates',
  '/view-templates/resolve',
  '/view-templates/:id',
  '/view-templates/:id/copy',
  '/view-templates/:id/fork',
  '/view-templates/:id/reset',
  '/view-templates/:id/detach',
] as const;

export const createBusinessTransportRouter = (ports: BusinessNamespacePorts): Hono => {
  const router = new Hono();
  router.route('/organizations', createOrganizationsBusinessRouter(ports.organizations));
  router.route('/folders', createFoldersBusinessRouter(ports.folders));
  router.route('/initiatives', createInitiativesBusinessRouter(ports.initiatives));
  router.route('/use-cases', createInitiativesBusinessRouter(ports.initiatives));
  router.route('/solutions', createSolutionsBusinessRouter(ports.solutions));
  router.route('/products', createProductsBusinessRouter(ports.products));
  router.route('/proposals', createProposalsBusinessRouter(ports.proposals));
  router.route('/bids', createBidsBusinessRouter(ports.bids));
  router.route('/view-templates', createViewTemplatesBusinessRouter(ports.viewTemplates));
  return router;
};
