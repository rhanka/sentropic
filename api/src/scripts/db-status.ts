#!/usr/bin/env tsx

import { db } from '../db/client';
import { sql } from 'drizzle-orm';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function checkDatabaseStatus() {
  console.log('📊 Database Status Report');
  console.log('========================');
  
  try {
    // Vérifier les tables
    const tables = await db.all(sql`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `);
    
    console.log(`\n📋 Tables (${tables.length}):`);
    for (const table of tables) {
      console.log(`  - ${table.name}`);
    }
    
    // Compter les enregistrements par table
    console.log('\n📈 Record counts:');
    for (const table of tables) {
      try {
        const count = await db.get(sql.raw(`SELECT COUNT(*) as count FROM ${table.name}`));
        console.log(`  - ${table.name}: ${count?.count || 0} records`);
      } catch (error) {
        console.log(`  - ${table.name}: Error counting records`);
      }
    }
    
    // Vérifier les migrations appliquées
    console.log('\n🔄 Migration status:');
    const migrationFiles = ['0000_easy_steel_serpent.sql', '0001_safe_adam_warlock.sql'];
    for (const file of migrationFiles) {
      const tableName = file.replace('.sql', '').replace('_', '');
      const exists = tables.some(t => t.name === tableName);
      console.log(`  - ${file}: ${exists ? '✅ Applied' : '❌ Not applied'}`);
    }
    
    // Vérifier l'intégrité
    console.log('\n🔍 Database integrity:');
    const integrity = await db.get(sql`PRAGMA integrity_check`);
    console.log(`  - Integrity: ${integrity?.integrity_check === 'ok' ? '✅ OK' : '❌ Issues found'}`);
    
  } catch (error) {
    console.error('❌ Error checking database status:', error);
    process.exit(1);
  }
}

checkDatabaseStatus();
