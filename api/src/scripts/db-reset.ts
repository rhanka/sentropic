#!/usr/bin/env tsx

import { pool } from '../db/client';

async function resetDatabase() {
  console.log('🗑️  Resetting Postgres database...');
  
  const client = await pool.connect();
  try {
    // Drop all tables in public schema
    console.log('🗑️  Dropping all tables...');
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    await client.query('GRANT ALL ON SCHEMA public TO public');
    console.log('✅ All tables dropped, schema recreated.');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
  
  console.log('✅ Database reset completed!');
  console.log('ℹ️  Restart API or run "make db-migrate" to recreate tables');
}

resetDatabase();
