#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '../../backups');
  const backupFile = path.join(backupDir, `app-${timestamp}.db`);
  
  console.log('💾 Creating database backup...');
  
  try {
    // Créer le répertoire de backup s'il n'existe pas
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // Copier le fichier de base de données
    const sourceDb = '/data/app.db';
    if (fs.existsSync(sourceDb)) {
      fs.copyFileSync(sourceDb, backupFile);
      console.log(`✅ Backup created: ${backupFile}`);
      
      // Afficher la taille du backup
      const stats = fs.statSync(backupFile);
      console.log(`📊 Backup size: ${(stats.size / 1024).toFixed(2)} KB`);
    } else {
      console.log('⚠️  Source database not found, creating empty backup');
      fs.writeFileSync(backupFile, '');
    }
    
  } catch (error) {
    console.error('❌ Error creating backup:', error);
    process.exit(1);
  }
}

backupDatabase();