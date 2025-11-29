#!/usr/bin/env tsx

import { runMigrations } from '../db/run-migrations';
import { pool } from '../db/client';

async function main() {
  console.log('🔄 Running Postgres migrations with drizzle...');
  try {
    await runMigrations();
    console.log('✅ Migrations applied');
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
