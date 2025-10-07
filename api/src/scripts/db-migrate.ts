#!/usr/bin/env tsx

import { db } from '../db/client';
import { sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigrations() {
  console.log('🔄 Running database migrations...');
  
  try {
    // Vérifier si la table de migration existe
    const migrationTableExists = await db.all(sql`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='_migrations'
    `) as { name: string }[];
    
    if (migrationTableExists.length === 0) {
      // Créer la table de suivi des migrations
      await db.run(sql`
        CREATE TABLE _migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT UNIQUE NOT NULL,
          applied_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('📋 Created migrations tracking table');
    }
    
    // Récupérer les migrations déjà appliquées
    const appliedMigrations = await db.all(sql`
      SELECT filename FROM _migrations ORDER BY applied_at
    `) as { filename: string }[];
    const appliedFilenames = appliedMigrations.map(m => m.filename);
    
    // Lire les fichiers de migration (ignorer les fichiers générés par drizzle-kit avec des noms débiles)
    const migrationsDir = path.join(__dirname, '../../drizzle');
    console.log(`📁 Looking for migrations in: ${migrationsDir}`);
    
    const allFiles = fs.readdirSync(migrationsDir);
    console.log(`📋 All files in migrations dir:`, allFiles);
    
    const migrationFiles = allFiles
      .filter(file => file.endsWith('.sql'))
      .filter(file => !file.match(/^\d+_[a-z_]+_[a-z_]+\.sql$/)) // Ignorer les noms générés automatiquement
      .filter(file => !file.startsWith('001_initial_schema.sql')) // Ignorer le schéma initial (géré par db:init)
      .sort();
    
    console.log(`🔄 Migration files to process:`, migrationFiles);
    
    let appliedCount = 0;
    
    for (const file of migrationFiles) {
      if (appliedFilenames.includes(file)) {
        console.log(`⏭️  Skipping already applied migration: ${file}`);
        continue;
      }
      
      const migrationPath = path.join(migrationsDir, file);
      const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
      
      console.log(`🔄 Applying migration: ${file}`);
      
      // Séparer les statements selon le format
      let statements: string[];
      
      if (migrationSQL.includes('--> statement-breakpoint')) {
        // Format drizzle-kit
        statements = migrationSQL
          .split('--> statement-breakpoint')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0);
      } else {
        // Format manuel (séparer par ';' et lignes vides)
        statements = migrationSQL
          .split(';')
          .map(stmt => stmt.trim())
          .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
      }
      
      // Appliquer chaque statement
      for (const statement of statements) {
        if (statement.trim()) {
          await db.run(sql.raw(statement + ';'));
        }
      }
      
      // Marquer la migration comme appliquée
      await db.run(sql`
        INSERT INTO _migrations (filename) VALUES (${file})
      `);
      
      appliedCount++;
      console.log(`✅ Applied migration: ${file}`);
    }
    
    if (appliedCount === 0) {
      console.log('✅ No new migrations to apply');
    } else {
      console.log(`✅ Applied ${appliedCount} migration(s)`);
    }
    
  } catch (error) {
    console.error('❌ Error running migrations:', error);
    process.exit(1);
  }
}

runMigrations();
