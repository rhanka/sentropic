#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function restoreDatabase() {
  const backupFile = process.argv[2];

  if (!backupFile) {
    console.error('❌ Usage: npm run db:restore <backup-file.sql>');
    console.log('Available backups:');
    const backupDir = path.join(__dirname, '../../backups');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.sql'));
      backups.forEach(backup => console.log(`  - ${backup}`));
    }
    process.exit(1);
  }

  const backupPath = path.join(__dirname, '../../backups', backupFile);
  console.log('🔄 Restoring Postgres database from SQL dump...');

  try {
    if (!fs.existsSync(backupPath)) {
      console.error(`❌ Backup file not found: ${backupPath}`);
      process.exit(1);
    }

    // Restore via psql in a throwaway container on same network
    execSync(`docker run --rm --network=$(basename $(pwd))_default -e PGPASSWORD=$POSTGRES_PASSWORD -v ${backupPath}:/dump.sql:ro postgres:16-alpine sh -lc "psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB -f /dump.sql"`, { stdio: 'inherit' });
    console.log(`✅ Database restored from: ${backupFile}`);
  } catch (error) {
    console.error('❌ Error restoring database:', error);
    process.exit(1);
  }
}

restoreDatabase();
