import { db } from '../db/client';
import { useCases } from '../db/schema';
import { sql } from 'drizzle-orm';

async function addUseCaseStatusColumn() {
  console.log('Adding status column to use_cases table...');
  try {
    await db.run(sql`ALTER TABLE use_cases ADD COLUMN status TEXT DEFAULT 'completed'`);
    console.log('✅ Status column added successfully');
  } catch (error: any) {
    if (error.message.includes('duplicate column name: status')) {
      console.log('Status column already exists, skipping.');
    } else {
      console.error('❌ Error adding status column:', error);
      throw error;
    }
  }
}

async function migrate() {
  await addUseCaseStatusColumn();
  console.log('Migration completed successfully');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
