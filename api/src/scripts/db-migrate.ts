#!/usr/bin/env tsx

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { pool } from '../db/client';
import { drizzle } from 'drizzle-orm/node-postgres';

async function runMigrations() {
  console.log('🔄 Running Postgres migrations with drizzle...');
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ Migrations applied');
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigrations();
