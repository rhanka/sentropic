import { db } from './client';
import { sql } from 'drizzle-orm';

/**
 * Ensure all recommended indexes exist for use_cases table (idempotent)
 * 
 * This function creates indexes for:
 * - JSONB data field for general queries
 * - JSONB data.name and data.description with pg_trgm for text search
 * - JSONB data.problem and data.solution with pg_trgm for text search
 * - Composite indexes for common query patterns
 * 
 * All indexes use IF NOT EXISTS, so it's safe to call multiple times.
 * 
 * @throws Error if index creation fails
 */
export async function ensureIndexes(): Promise<void> {
  // Extension pg_trgm pour recherche textuelle efficace
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

  // Index sur data.name (JSONB) avec pg_trgm
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_data_name_trgm 
    ON use_cases USING GIN ((data->>'name') gin_trgm_ops)
  `);

  // Index sur data.description (JSONB) avec pg_trgm
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_data_description_trgm 
    ON use_cases USING GIN ((data->>'description') gin_trgm_ops)
  `);

  // Index composite pour requêtes fréquentes (folder_id + data.name)
  // Note: on utilise une expression pour extraire data.name
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_folder_data_name 
    ON use_cases (folder_id, (data->>'name'))
  `);

  // Index GIN sur data JSONB pour requêtes générales
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_data_gin 
    ON use_cases USING GIN (data)
  `);

  // Index sur data.problem avec pg_trgm
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_data_problem_trgm 
    ON use_cases USING GIN ((data->>'problem') gin_trgm_ops)
  `);

  // Index sur data.solution avec pg_trgm
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_data_solution_trgm 
    ON use_cases USING GIN ((data->>'solution') gin_trgm_ops)
  `);

  // Index pour tri/filtrage sur statut (folder_id + status)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_use_cases_folder_status 
    ON use_cases (folder_id, status)
  `);
}

