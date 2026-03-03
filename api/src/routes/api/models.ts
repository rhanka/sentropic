import { Hono } from 'hono';
import { getModelCatalogPayload } from '../../services/model-catalog';
import { listProviderConnections } from '../../services/provider-connections';

export const modelsRouter = new Hono();

modelsRouter.get('/catalog', async (c) => {
  try {
    const user = c.get('user') as { userId?: string } | undefined;
    const payload = await getModelCatalogPayload({
      userId: user?.userId ?? null,
    });
    return c.json(payload);
  } catch (error) {
    console.error('Error fetching model catalog:', error);
    return c.json({ message: 'Failed to fetch model catalog' }, 500);
  }
});

modelsRouter.get('/provider-readiness', async (c) => {
  try {
    const providers = await listProviderConnections();
    return c.json({
      providers: providers.map((provider) => ({
        providerId: provider.providerId,
        label: provider.label,
        ready: provider.ready,
        managedBy: provider.managedBy,
        accountLabel: provider.accountLabel,
      })),
    });
  } catch (error) {
    console.error('Error fetching provider readiness:', error);
    return c.json({ message: 'Failed to fetch provider readiness' }, 500);
  }
});
