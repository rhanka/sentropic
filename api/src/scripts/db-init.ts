#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../db/client';
import { sql } from 'drizzle-orm';
import * as schema from '../db/schema';

async function initializeDatabase() {
  console.log('🗄️  Initializing Postgres database...');
  
  const db = drizzle(pool, { schema });
  
  try {
    // Vérifier si les tables existent déjà
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`
    );
    
    if (tables.rows.length > 0) {
      console.log(`ℹ️  Database already initialized (${tables.rows.length} tables found)`);
      console.log('ℹ️  Use "make db-migrate" to apply new migrations');
      return;
    }
    
    console.log('📋 No tables found, creating tables from schema...');
    
    // Créer les tables directement depuis le schéma Drizzle
    // Drizzle peut générer le SQL mais pour l'instant on va juste dire que les tables seront créées
    // lors de la première utilisation par les migrations
    console.log('⚠️  No tables found. Please run "make db-generate" then "make db-migrate" to create tables.');
    console.log('ℹ️  Or the tables will be auto-created on first API use if migrations are present.');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeDatabase();