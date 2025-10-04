import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../../db/client';
import { companies } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { askWithWebSearch } from '../../services/openai';
import { defaultPrompts } from '../../config/default-prompts';

// Configuration métier par défaut
const industries = {
  industries: [
    { name: 'Technologie' },
    { name: 'Santé' },
    { name: 'Finance' },
    { name: 'Éducation' },
    { name: 'Retail' },
    { name: 'Manufacturing' },
    { name: 'Services' },
    { name: 'Immobilier' },
    { name: 'Transport' },
    { name: 'Énergie' },
    { name: 'Agroalimentaire' },
    { name: 'Média' },
    { name: 'Télécommunications' },
    { name: 'Automobile' },
    { name: 'Aéronautique' }
  ]
};

const companyInfoPrompt = defaultPrompts.find(p => p.id === 'company_info')?.content || '';

// Fonction d'enrichissement asynchrone
async function enrichCompanyAsync(companyId: string, companyName: string, model: string = 'gpt-5') {
  try {
    console.log(`Starting async enrichment for company ${companyId}: ${companyName}`);
    
    // Utiliser le prompt company_info avec recherche web
    const industriesList = industries.industries.map(i => i.name).join(', ');
    const prompt = companyInfoPrompt
      .replace('{{company_name}}', companyName)
      .replace('{{industries}}', industriesList);
    
    const enrichedData = await askWithWebSearch(prompt, model);
    
    // Extraire le contenu de la réponse OpenAI et parser le JSON
    const content = enrichedData.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Aucune réponse reçue de l\'IA');
    }
    
    const parsedData = JSON.parse(content);
    
    // Mettre à jour l'entreprise avec les données enrichies
    await db.update(companies)
      .set({
        ...parsedData,
        status: 'completed',
        updatedAt: new Date().toISOString()
      })
      .where(eq(companies.id, companyId));
    
    console.log(`✅ Company ${companyId} enriched successfully`);
  } catch (error) {
    console.error(`❌ Error enriching company ${companyId}:`, error);
    
    // En cas d'erreur, marquer comme draft pour permettre une nouvelle tentative
    await db.update(companies)
      .set({ 
        status: 'draft',
        updatedAt: new Date().toISOString()
      })
      .where(eq(companies.id, companyId));
  }
}

const companyInput = z.object({
  name: z.string().min(1),
  industry: z.string().optional(),
  size: z.string().optional(),
  products: z.string().optional(),
  processes: z.string().optional(),
  challenges: z.string().optional(),
  objectives: z.string().optional(),
  technologies: z.string().optional(),
  status: z.enum(['draft', 'enriching', 'completed']).default('completed')
});

export const companiesRouter = new Hono();

companiesRouter.get('/', async (c) => {
  const rows = await db.select().from(companies);
  return c.json({ items: rows });
});

companiesRouter.post('/', zValidator('json', companyInput), async (c) => {
  const payload = c.req.valid('json');
  const id = createId();
  await db.insert(companies).values({ id, ...payload });
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(company, 201);
});

// POST /api/v1/companies/draft - Créer une entreprise en mode brouillon
companiesRouter.post('/draft', zValidator('json', z.object({
  name: z.string().min(1)
})), async (c) => {
  const { name } = c.req.valid('json');
  const id = createId();
  
  await db.insert(companies).values({
    id,
    name,
    status: 'draft'
  });
  
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(company, 201);
});

// POST /api/v1/companies/:id/enrich - Enrichir une entreprise de manière asynchrone
companiesRouter.post('/:id/enrich', async (c) => {
  const id = c.req.param('id');
  const { model } = await c.req.json().catch(() => ({}));
  const selectedModel = model || 'gpt-5';
  
  try {
    // Récupérer l'entreprise
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    if (!company) {
      return c.json({ message: 'Entreprise non trouvée' }, 404);
    }
    
    // Mettre à jour le statut à "enriching"
    await db.update(companies)
      .set({ status: 'enriching' })
      .where(eq(companies.id, id));
    
    // Lancer l'enrichissement en arrière-plan (sans attendre)
    enrichCompanyAsync(id, company.name, selectedModel);
    
    return c.json({ 
      success: true, 
      message: 'Enrichissement démarré',
      status: 'enriching'
    });
  } catch (error) {
    console.error('Error starting enrichment:', error);
    return c.json({ 
      success: false, 
      message: 'Erreur lors du démarrage de l\'enrichissement' 
    }, 500);
  }
});

companiesRouter.get('/:id', async (c) => {
  const id = c.req.param('id');
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  if (!company) {
    return c.json({ message: 'Not found' }, 404);
  }
  return c.json(company);
});

companiesRouter.put('/:id', zValidator('json', companyInput.partial()), async (c) => {
  const id = c.req.param('id');
  const payload = c.req.valid('json');
  const result = await db.update(companies).set(payload).where(eq(companies.id, id)).run();
  if (result.changes === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  return c.json(company);
});

companiesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(companies).where(eq(companies.id, id));
  return c.body(null, 204);
});

// Endpoint pour l'enrichissement automatique des entreprises
const aiEnrichInput = z.object({
  name: z.string().min(1),
  model: z.string().optional()
});

companiesRouter.post('/ai-enrich', zValidator('json', aiEnrichInput), async (c) => {
  try {
    const { name, model } = c.req.valid('json');
    const selectedModel = model || 'gpt-5';
    
    // Utiliser le prompt company_info avec recherche web
    const industriesList = industries.industries.map(i => i.name).join(', ');
    const prompt = companyInfoPrompt
      .replace('{{company_name}}', name)
      .replace('{{industries}}', industriesList);
    
    const enrichedData = await askWithWebSearch(prompt, selectedModel);
    
    // Extraire le contenu de la réponse OpenAI et parser le JSON
    const content = enrichedData.choices[0]?.message?.content;
    if (!content) {
      throw new Error('Aucune réponse reçue de l\'IA');
    }
    
    try {
      const parsedData = JSON.parse(content);
      return c.json(parsedData);
    } catch (parseError) {
      console.error('Erreur de parsing JSON:', parseError);
      console.error('Contenu reçu:', content);
      throw new Error('Erreur lors du parsing de la réponse de l\'IA');
    }
  } catch (error) {
    console.error('Error in ai-enrich endpoint:', error);
    return c.json(
      { 
        message: 'Failed to enrich company data', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});
