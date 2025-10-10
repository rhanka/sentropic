#!/usr/bin/env tsx

import { drizzle } from 'drizzle-orm/node-postgres';
import { pool } from '../db/client';

async function checkDatabaseStatus() {
  console.log('📊 Database Status Report (Postgres)');
  console.log('========================');

  const db = drizzle(pool);
  try {
    // Lister les tables du schéma public
    const tables = await db.execute(
      // eslint-disable-next-line drizzle/enforce-query-usage
      { 
        // raw query compatible drizzle execute
        sql: `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
        params: []
      } as any
    ) as unknown as { rows: { table_name: string }[] };

    const tableNames = tables?.rows?.map(r => r.table_name) || [];
    console.log(`\n📋 Tables (${tableNames.length}):`);
    tableNames.forEach(name => console.log(`  - ${name}`));

    // Compter les enregistrements par table
    console.log('\n📈 Record counts:');
    for (const name of tableNames) {
      try {
        const res = await db.execute({ sql: `SELECT COUNT(*)::int AS count FROM "${name}"`, params: [] } as any) as unknown as { rows: { count: number }[] };
        const count = res?.rows?.[0]?.count ?? 0;
        console.log(`  - ${name}: ${count} records`);
      } catch {
        console.log(`  - ${name}: Error counting records`);
      }
    }
  } catch (error) {
    console.error('❌ Error checking database status:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDatabaseStatus();
