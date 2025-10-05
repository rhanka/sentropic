#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function restoreDatabase() {
  const backupFile = process.argv[2];
  
  if (!backupFile) {
    console.error('❌ Usage: npm run db:restore <backup-file>');
    console.log('Available backups:');
    const backupDir = path.join(__dirname, '../../backups');
    if (fs.existsSync(backupDir)) {
      const backups = fs.readdirSync(backupDir).filter(f => f.endsWith('.db'));
      backups.forEach(backup => console.log(`  - ${backup}`));
    }
    process.exit(1);
  }
  
  const backupPath = path.join(__dirname, '../../backups', backupFile);
  const targetDb = '/data/app.db';
  
  console.log('🔄 Restoring database from backup...');
  
  try {
    if (!fs.existsSync(backupPath)) {
      console.error(`❌ Backup file not found: ${backupPath}`);
      process.exit(1);
    }
    
    // Créer une sauvegarde de sécurité avant restauration
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safetyBackup = `/data/app-safety-${timestamp}.db`;
    
    if (fs.existsSync(targetDb)) {
      fs.copyFileSync(targetDb, safetyBackup);
      console.log(`🛡️  Safety backup created: ${safetyBackup}`);
    }
    
    // Restaurer la base de données
    fs.copyFileSync(backupPath, targetDb);
    console.log(`✅ Database restored from: ${backupFile}`);
    
    // Vérifier la taille
    const stats = fs.statSync(targetDb);
    console.log(`📊 Restored database size: ${(stats.size / 1024).toFixed(2)} KB`);
    
  } catch (error) {
    console.error('❌ Error restoring database:', error);
    process.exit(1);
  }
}

restoreDatabase();
