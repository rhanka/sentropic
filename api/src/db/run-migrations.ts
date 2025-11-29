import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './client';

/**
 * Run database migrations (idempotent)
 * 
 * This function applies all pending migrations from the drizzle folder.
 * It's safe to call multiple times as migrations are idempotent.
 * 
 * @throws Error if migrations fail
 */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: './drizzle' });
}

