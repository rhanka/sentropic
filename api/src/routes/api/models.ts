import { Hono } from 'hono';
import { getModelCatalogPayload } from '../../services/model-catalog';

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
