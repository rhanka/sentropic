#!/usr/bin/env tsx

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from '../db/client';
import { sql } from 'drizzle-orm';

async function initializeDatabase() {
  console.log('🗄️  Initializing Postgres database...');
  
  try {
    // Vérifier si les tables existent déjà
    const tables = await db.all(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`) as { table_name: string }[];
    
    if (tables.length > 0) {
      console.log(`ℹ️  Database already initialized (${tables.length} tables found)`);
      console.log('ℹ️  Use "make db-migrate" to apply new migrations');
      return;
    }
    
    console.log('📋 No tables found, running initial migration...');
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ Database initialized successfully');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeDatabase();