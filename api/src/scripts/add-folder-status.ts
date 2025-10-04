import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function addFolderStatusColumn() {
  try {
    console.log('Adding status column to folders table...');
    
    // Ajouter la colonne status avec une valeur par défaut
    await db.run(sql`
      ALTER TABLE folders 
      ADD COLUMN status TEXT DEFAULT 'completed'
    `);
    
    console.log('✅ Status column added successfully');
  } catch (error) {
    console.error('❌ Error adding status column:', error);
    throw error;
  }
}

// Exécuter la migration
addFolderStatusColumn()
  .then(() => {
    console.log('Migration completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
