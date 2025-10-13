#!/usr/bin/env tsx

import { db, pool } from '../db/client';
import { sql } from 'drizzle-orm';

async function checkDatabaseStatus() {
  console.log('📊 Database Status Report (Postgres)');
  console.log('========================');

  try {
    // Lister les tables du schéma public
    const tables = await db.all(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`) as { table_name: string }[];

    console.log(`\n📋 Tables (${tables.length}):`);
    tables.forEach(t => console.log(`  - ${t.table_name}`));

    // Compter les enregistrements par table
    console.log('\n📈 Record counts:');
    for (const table of tables) {
      try {
        const res = await db.get(sql.raw(`SELECT COUNT(*)::int AS count FROM "${table.table_name}"`)) as { count: number } | undefined;
        const count = res?.count ?? 0;
        console.log(`  - ${table.table_name}: ${count} records`);
      } catch {
        console.log(`  - ${table.table_name}: Error counting records`);
      }
    }

    // Vérifier les migrations Drizzle
    console.log('\n🔄 Drizzle Migration status:');
    try {
      const migrations = await db.all(sql`SELECT * FROM "__drizzle_migrations" ORDER BY created_at DESC`) as { id: number; hash: string; created_at: number }[];
      if (migrations.length > 0) {
        console.log(`  ✅ ${migrations.length} migration(s) applied (latest: ${migrations[0].hash})`);
      } else {
        console.log('  ❌ No Drizzle migrations applied');
      }
    } catch {
      console.log('  ℹ️  Migration table not found (first run)');
    }

    // Version de la base de données
    console.log('\n🔍 Database version:');
    const version = await db.get(sql`SELECT version()`) as { version: string } | undefined;
    console.log(`  - ${version?.version || 'Unknown'}`);

    // Taille de la base de données
    console.log('\n💾 Database size:');
    const dbSize = await db.get(sql`SELECT pg_size_pretty(pg_database_size(current_database())) as size`) as { size: string } | undefined;
    console.log(`  - ${dbSize?.size || 'Unknown'}`);

  } catch (error) {
    console.error('❌ Error checking database status:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

checkDatabaseStatus();
