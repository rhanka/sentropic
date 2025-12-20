import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db, pool } from '../../db/client';
import { companies, folders, useCases } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { createId } from '../../utils/id';
import { enrichCompany } from '../../services/context-company';
import { queueManager } from '../../services/queue-manager';
import { settingsService } from '../../services/settings';

// Fonction d'enrichissement asynchrone (désactivée, utilisation directe de enrichCompany)
// async function enrichCompanyAsync(companyId: string, companyName: string, model: string = 'gpt-4.1-nano') {
//   try {
//     console.log(`Starting async enrichment for company ${companyId}: ${companyName}`);
//     
//     // Utiliser le service de contexte
//     const enrichedData = await enrichCompany(companyName, model);
//     
//     // Mettre à jour l'entreprise avec les données enrichies
//     await db.update(companies)
//       .set({
//         ...enrichedData,
//         status: 'completed',
//         updatedAt: new Date()
//       })
//       .where(eq(companies.id, companyId));
//     
//     console.log(`✅ Company ${companyId} enriched successfully`);
//   } catch (error) {
//     console.error(`❌ Error enriching company ${companyId}:`, error);
//     
//     // En cas d'erreur, marquer comme draft pour permettre une nouvelle tentative
//     await db.update(companies)
//       .set({ 
//         status: 'draft',
//         updatedAt: new Date()
//       })
//       .where(eq(companies.id, companyId));
//   }
// }

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

async function notifyCompanyEvent(companyId: string): Promise<void> {
  const notifyPayload = JSON.stringify({ company_id: companyId });
  const client = await pool.connect();
  try {
    await client.query(`NOTIFY company_events, '${notifyPayload.replace(/'/g, "''")}'`);
  } finally {
    client.release();
  }
}

companiesRouter.get('/', async (c) => {
  const rows = await db.select().from(companies);
  return c.json({ items: rows });
});

companiesRouter.post('/', zValidator('json', companyInput), async (c) => {
  const payload = c.req.valid('json');
  const id = createId();
  await db.insert(companies).values({ id, ...payload });
  const [company] = await db.select().from(companies).where(eq(companies.id, id));
  await notifyCompanyEvent(id);
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
  await notifyCompanyEvent(id);
  return c.json(company, 201);
});

// POST /api/v1/companies/:id/enrich - Enrichir une entreprise de manière asynchrone
companiesRouter.post('/:id/enrich', async (c) => {
  const id = c.req.param('id');
  const { model } = await c.req.json().catch(() => ({}));
  
  // Récupérer le modèle par défaut depuis les settings si non fourni
  const aiSettings = await settingsService.getAISettings();
  const selectedModel = model || aiSettings.defaultModel;
  
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
    await notifyCompanyEvent(id);
    
    // Ajouter le job à la queue
    const jobId = await queueManager.addJob('company_enrich', {
      companyId: id,
      companyName: company.name,
      model: selectedModel
    });
    
    return c.json({ 
      success: true, 
      message: 'Enrichissement démarré',
      status: 'enriching',
      jobId
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
  const updated = await db
    .update(companies)
    .set(payload)
    .where(eq(companies.id, id))
    .returning();
  if (updated.length === 0) {
    return c.json({ message: 'Not found' }, 404);
  }
  await notifyCompanyEvent(id);
  return c.json(updated[0]);
});

// Endpoint pour l'enrichissement automatique des entreprises
const aiEnrichInput = z.object({
  name: z.string().min(1),
  model: z.string().optional()
});

companiesRouter.post('/ai-enrich', zValidator('json', aiEnrichInput), async (c) => {
  try {
  const { name, model } = c.req.valid('json');
  const selectedModel = model || 'gpt-4.1-nano';
    
    // Utiliser le service de contexte
    const enrichedData = await enrichCompany(name, selectedModel);
    
    return c.json(enrichedData);
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

// DELETE /api/v1/companies/:id - Supprimer une entreprise
companiesRouter.delete('/:id', async (c) => {
  const id = c.req.param('id');
  
  try {
    // Vérifier que l'entreprise existe
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    if (!company) {
      return c.json({ message: 'Entreprise non trouvée' }, 404);
    }
    
    // Vérifier s'il y a des dépendances
    const relatedFolders = await db.select().from(folders).where(eq(folders.companyId, id));
    const relatedUseCases = await db.select().from(useCases).where(eq(useCases.companyId, id));
    
    // Si des dépendances existent, retourner une erreur 409 (Conflict)
    if (relatedFolders.length > 0 || relatedUseCases.length > 0) {
      return c.json({
        message: 'Impossible de supprimer l\'entreprise car elle est utilisée',
        details: {
          folders: relatedFolders.length,
          useCases: relatedUseCases.length
        },
        suggestion: 'Supprimez d\'abord les dossiers et cas d\'usage associés, ou utilisez une suppression en cascade.'
      }, 409);
    }
    
    // Supprimer l'entreprise
    await db.delete(companies).where(eq(companies.id, id));
    await notifyCompanyEvent(id);
    
    return c.body(null, 204);
  } catch (error) {
    console.error('Error deleting company:', error);
    
    // Détecter les erreurs de contrainte de clé étrangère
    if (error instanceof Error && error.message.includes('FOREIGN KEY constraint')) {
      return c.json(
        {
          message: 'Impossible de supprimer l\'entreprise car elle est utilisée par d\'autres entités',
          error: 'FOREIGN_KEY_CONSTRAINT'
        },
        409
      );
    }
    
    return c.json(
      {
        message: 'Erreur lors de la suppression de l\'entreprise',
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      500
    );
  }
});
