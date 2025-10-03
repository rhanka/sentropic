import { Hono } from 'hono';
import { db } from '../../db/client';
import { companies, folders, useCases } from '../../db/schema';
import { sql } from 'drizzle-orm';

export const adminRouter = new Hono();

adminRouter.post('/reset', async (c) => {
  try {
    // Supprimer toutes les données dans l'ordre inverse des dépendances
    await db.delete(useCases);
    await db.delete(folders);
    await db.delete(companies);
    
    return c.json({ 
      message: 'All data has been reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting data:', error);
    return c.json(
      { 
        message: 'Failed to reset data', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});

adminRouter.get('/stats', async (c) => {
  try {
    const [companiesCount] = await db.select({ count: sql`count(*)` }).from(companies);
    const [foldersCount] = await db.select({ count: sql`count(*)` }).from(folders);
    const [useCasesCount] = await db.select({ count: sql`count(*)` }).from(useCases);
    
    return c.json({
      companies: companiesCount.count,
      folders: foldersCount.count,
      useCases: useCasesCount.count,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    return c.json(
      { 
        message: 'Failed to get statistics', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }, 
      500
    );
  }
});
