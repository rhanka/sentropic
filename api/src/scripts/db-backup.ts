#!/usr/bin/env tsx

import { execSync } from 'node:child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '../../backups');
  const backupFile = path.join(backupDir, `app-${timestamp}.sql`);

  console.log('💾 Creating Postgres database backup...');

  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    // Use pg_dump inside the api container's network; assumes env DATABASE_URL is set
    // For local docker-compose, psql/pg_dump can be available via a lightweight container
    execSync(`docker run --rm --network=$(basename $(pwd))_default -e PGPASSWORD=$POSTGRES_PASSWORD postgres:16-alpine pg_dump -h postgres -U $POSTGRES_USER -d $POSTGRES_DB -F p -f -`, { stdio: ['ignore', 'pipe', 'inherit'] });
    // Simpler approach: rely on DATABASE_URL parsing in a proper script later. Placeholder kept minimal here.

    // For this iteration, we simply inform that backup strategy is pg_dump-based.
    fs.writeFileSync(backupFile, '-- pg_dump output captured via CI/Make (see Make target)');
    console.log(`✅ Backup placeholder created: ${backupFile}`);
  } catch (error) {
    console.error('❌ Error creating backup:', error);
    process.exit(1);
  }
}

backupDatabase();