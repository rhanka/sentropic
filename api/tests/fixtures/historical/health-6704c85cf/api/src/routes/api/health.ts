import { Hono } from 'hono';
import { db } from '../../db/client';
import { jobQueue, settings } from '../../db/schema';

export const healthRouter = new Hono();

healthRouter.get('/', async (c) => {
  try {
    // Vérifier la connexion à la base de données avec plusieurs tables
    await Promise.all([
      db.select().from(settings).limit(1),
      db.select().from(jobQueue).limit(1)
    ]);
    
    return c.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok',
        tables: {
          settings: 'accessible',
          jobQueue: 'accessible'
        }
      }
    });
  } catch (error) {
    console.error('Health check failed:', error);
    return c.json({ 
      status: 'error', 
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, 503);
  }
});
