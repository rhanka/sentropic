import { bidsRouter } from '../../../services/business/bids';
import { foldersRouter } from '../../../services/business/folders';
import { initiativesRouter } from '../../api/initiatives';
import { organizationsRouter } from '../../../services/business/organizations';
import { productsRouter } from '../../../services/business/products';
import { proposalsRouter } from '../../../services/business/proposals';
import { solutionsRouter } from '../../../services/business/solutions';
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
