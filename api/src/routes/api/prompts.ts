import { Hono } from 'hono';
import { z } from 'zod';
import { executeWithTools } from '../../services/tools';
import { defaultPrompts } from '../../config/default-prompts';

const promptsRouter = new Hono();

// Schéma pour la validation des prompts
const promptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  content: z.string(),
  variables: z.array(z.string())
});

const updatePromptsSchema = z.object({
  prompts: z.array(promptSchema)
});


// GET /api/v1/prompts - Récupérer tous les prompts
promptsRouter.get('/', (c) => {
  return c.json({ prompts: defaultPrompts });
});

// PUT /api/v1/prompts - Mettre à jour les prompts
promptsRouter.put('/', async (c) => {
  try {
    const body = await c.req.json();
    const validatedData = updatePromptsSchema.parse(body);
    
    // Ici on pourrait sauvegarder en base de données
    // Pour l'instant, on retourne juste les données validées
    return c.json({ 
      success: true, 
      message: 'Prompts mis à jour avec succès',
      prompts: validatedData.prompts 
    });
  } catch (error) {
    console.error('Error updating prompts:', error);
    return c.json({ 
      success: false, 
      message: 'Erreur lors de la mise à jour des prompts',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 400);
  }
});

// Endpoint de test pour Tavily
promptsRouter.post('/test-tavily', async (c) => {
  try {
    const { question } = await c.req.json();
    
    if (!question) {
      return c.json({ 
        success: false, 
        message: 'Question requise' 
      }, 400);
    }

    const result = await executeWithTools(question, { useWebSearch: true });
    
    return c.json({ 
      success: true, 
      result: result 
    });
  } catch (error) {
    console.error('Error testing Tavily:', error);
    return c.json({ 
      success: false, 
      message: 'Erreur lors du test Tavily',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

export default promptsRouter;
