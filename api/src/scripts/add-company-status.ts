import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function addCompanyStatusColumn() {
  try {
    console.log('Adding status column to companies table...');
    
    // Ajouter la colonne status avec une valeur par défaut
    await db.run(sql`
      ALTER TABLE companies 
      ADD COLUMN status TEXT DEFAULT 'completed'
    `);
    
    console.log('✅ Status column added successfully');
  } catch (error) {
    console.error('❌ Error adding status column:', error);
    throw error;
  }
}

// Exécuter la migration
addCompanyStatusColumn()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
