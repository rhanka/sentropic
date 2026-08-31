import { Hono } from 'hono';
import { z } from 'zod';

import type { AgentsCatalogPort, AgentsSkillsPort } from './agents-ports';

const promptProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  variables: z.array(z.string()),
});
const updatePromptProfilesSchema = z.object({
  prompts: z.array(promptProfileSchema),
});

export const createAgentPromptsRouter = (ports: {
  readonly catalog: AgentsCatalogPort;
  readonly skills: AgentsSkillsPort;
}): Hono => {
  const router = new Hono();

  router.get('/', (context) => context.json({
    prompts: ports.catalog.listPromptProfiles(),
  }));

  router.put('/', async (context) => {
    try {
      const body = updatePromptProfilesSchema.parse(await context.req.json());
      const prompts = await ports.catalog.updatePromptProfiles(body.prompts);
      return context.json({
        success: true,
        message: 'Prompts mis à jour avec succès',
        prompts,
      });
    } catch (error) {
      console.error('Error updating prompts:', error);
      return context.json({
        success: false,
        message: 'Erreur lors de la mise à jour des prompts',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 400);
    }
  });

  router.post('/test-tavily', async (context) => {
    try {
      const { question } = await context.req.json();
      if (!question) {
        return context.json({ success: false, message: 'Question requise' }, 400);
      }
      const result = await ports.skills.testPrompt(question);
      return context.json({ success: true, result });
    } catch (error) {
      console.error('Error testing Tavily:', error);
      return context.json({
        success: false,
        message: 'Erreur lors du test Tavily',
        error: error instanceof Error ? error.message : 'Unknown error',
      }, 500);
    }
  });

  return router;
};
