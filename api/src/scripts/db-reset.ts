#!/usr/bin/env tsx

import { execSync } from 'node:child_process';

async function resetDatabase() {
  console.log('🗑️  Resetting Postgres database...');
  try {
    // Drop and recreate database using psql (within a disposable container on same network)
    execSync('docker run --rm --network=$(basename $(pwd))_default -e PGPASSWORD=$POSTGRES_PASSWORD postgres:16-alpine sh -lc "psql -h postgres -U $POSTGRES_USER -c \"DROP SCHEMA public CASCADE; CREATE SCHEMA public;\" $POSTGRES_DB"', { stdio: 'inherit' });
    console.log('✅ Database schema reset');
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
