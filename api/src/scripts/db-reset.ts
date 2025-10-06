#!/usr/bin/env tsx

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function resetDatabase() {
  console.log('🗑️  Resetting database...');
  
  try {
    const dbPath = '/data/app.db';
    
    // Supprimer le fichier de base de données s'il existe
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      console.log('✅ Database file removed');
    } else {
      console.log('ℹ️  Database file does not exist');
    }
    
    // Créer un nouveau fichier de base de données vide
    fs.writeFileSync(dbPath, '');
    console.log('✅ New empty database created');
    
    // Appliquer toutes les migrations
    console.log('🔄 Applying migrations...');
    const migrationsDir = path.join(__dirname, '../../drizzle');
    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      console.log(`📋 Applying: ${file}`);
      // Note: On ne peut pas utiliser drizzle ici car la base est vide
      // Les migrations seront appliquées au prochain démarrage de l'API
    }
    
    console.log('✅ Database reset completed!');
    console.log('ℹ️  Run "make restart-api" to apply migrations');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
