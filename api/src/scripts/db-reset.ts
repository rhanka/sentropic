#!/usr/bin/env tsx

import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function resetDatabase() {
  console.log('🗑️  Resetting Postgres database...');
  
  try {
    // Drop all tables
    const tables = await db.all(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`) as { tablename: string }[];
    for (const table of tables) {
      await db.run(sql.raw(`DROP TABLE IF EXISTS "${table.tablename}" CASCADE`));
    }
    await db.run(sql`DROP TABLE IF EXISTS "__drizzle_migrations"`);
    console.log('✅ All tables dropped.');

    // Re-initialize database (run migrations)
    console.log('🔄 Re-initializing database...');
    const { execa } = await import('execa');
    await execa('npm', ['run', 'db:init'], { stdio: 'inherit' });
    
    console.log('✅ Database reset completed!');
    
  } catch (error) {
    console.error('❌ Error resetting database:', error);
    process.exit(1);
  }
}

resetDatabase();
