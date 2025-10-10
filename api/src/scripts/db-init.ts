#!/usr/bin/env tsx

import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../db/client';

async function initializeDatabase() {
  console.log('🗄️  Initializing Postgres database (running migrations)...');
  
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: 'drizzle' });
    console.log('✅ Database initialized (migrations applied)');
    
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initializeDatabase();