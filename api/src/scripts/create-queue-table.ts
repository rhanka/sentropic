import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function createQueueTable() {
  console.log('Creating job_queue table...');
  try {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS job_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        error TEXT
      )
    `);
    console.log('✅ Job queue table created successfully');
  } catch (error) {
    console.error('❌ Error creating job queue table:', error);
    throw error;
  }
}

async function migrate() {
  await createQueueTable();
  console.log('Migration completed successfully');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
