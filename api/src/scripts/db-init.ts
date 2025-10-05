#!/usr/bin/env tsx

import { db } from '../db/client';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { 
  companies, 
  folders, 
  useCases, 
  settings, 
  businessConfig, 
  sessions, 
  jobQueue 
} from '../db/schema';

async function initializeDatabase() {
  console.log('🗄️  Initializing database...');
  
  try {
    // Vérifier les tables existantes
    const tables = await db.all(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    const existingTableNames = tables.map(t => t.name);
    
    console.log('📋 Existing tables:', existingTableNames);
    
    // Liste des tables requises
    const requiredTables = ['companies', 'folders', 'use_cases', 'settings', 'business_config', 'sessions', 'job_queue'];
    const missingTables = requiredTables.filter(name => !existingTableNames.includes(name));
    
    if (missingTables.length === 0) {
      console.log('✅ All required tables already exist');
      console.log('ℹ️  Use "make db-migrate" to apply migrations');
      return;
    }
    
    console.log('🔄 Creating missing tables:', missingTables);
    
    // Créer toutes les tables via Drizzle
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS companies (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        industry text,
        size text,
        products text,
        processes text,
        challenges text,
        objectives text,
        technologies text,
        status text DEFAULT 'completed',
        created_at text DEFAULT CURRENT_TIMESTAMP,
        updated_at text DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS folders (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        description text,
        company_id text REFERENCES companies(id),
        matrix_config text,
        status text DEFAULT 'completed',
        created_at text DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS use_cases (
        id text PRIMARY KEY NOT NULL,
        folder_id text NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        company_id text REFERENCES companies(id),
        name text NOT NULL,
        description text,
        process text,
        domain text,
        technologies text,
        prerequisites text,
        deadline text,
        contact text,
        benefits text,
        metrics text,
        risks text,
        next_steps text,
        sources text,
        related_data text,
        "references" text,
        value_scores text,
        complexity_scores text,
        total_value_score integer,
        total_complexity_score integer,
        status text DEFAULT 'completed',
        created_at text DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS settings (
        key text PRIMARY KEY NOT NULL,
        value text,
        description text,
        updated_at text DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS business_config (
        id text PRIMARY KEY NOT NULL,
        sectors text,
        processes text
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id text PRIMARY KEY NOT NULL,
        provider text,
        profile text,
        user_id text,
        created_at text DEFAULT CURRENT_TIMESTAMP,
        expires_at text
      )
    `);

    await db.run(sql`
      CREATE TABLE IF NOT EXISTS job_queue (
        id text PRIMARY KEY NOT NULL,
        type text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        data text NOT NULL,
        result text,
        error text,
        created_at text DEFAULT CURRENT_TIMESTAMP,
        started_at text,
        completed_at text
      )
    `);

    // Vérifier les tables créées
    const finalTables = await db.all(sql`SELECT name FROM sqlite_master WHERE type='table'`);
    console.log('✅ Database initialized successfully!');
    console.log('📊 Tables created:', finalTables.map(t => t.name));
    console.log('ℹ️  Run "make db-migrate" to apply any pending migrations');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  }
}

initializeDatabase();