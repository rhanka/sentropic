import { bidsRouter } from '../../api/bids';
import { foldersRouter } from '../../api/folders';
import { initiativesRouter } from '../../api/initiatives';
import { organizationsRouter } from '../../api/organizations';
import { productsRouter } from '../../api/products';
import { proposalsRouter } from '../../api/proposals';
import { solutionsRouter } from '../../api/solutions';
import { viewTemplatesRouter } from '../../api/view-templates';
import type { BusinessNamespacePorts, BusinessRouterPort } from './ports';

const productRouter = (router: ReturnType<BusinessRouterPort['createRouter']>): BusinessRouterPort => ({
  createRouter: () => router,
});

export const productBusinessPorts: BusinessNamespacePorts = {
  organizations: productRouter(organizationsRouter),
  folders: productRouter(foldersRouter),
  initiatives: productRouter(initiativesRouter),
  solutions: productRouter(solutionsRouter),
  products: productRouter(productsRouter),
  proposals: productRouter(proposalsRouter),
  bids: productRouter(bidsRouter),
  viewTemplates: productRouter(viewTemplatesRouter),
};
