import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function checkFolderTable() {
  try {
    console.log('Checking folders table structure...');
    
    // Vérifier la structure de la table
    const result = await db.run(sql`PRAGMA table_info(folders)`);
    console.log('Table structure:', result);
    
    // Essayer d'insérer un dossier de test
    const testFolder = {
      id: 'test-folder-id',
      name: 'Test Folder',
      description: 'Test description',
      status: 'completed',
      createdAt: new Date().toISOString()
    };
    
    await db.run(sql`
      INSERT INTO folders (id, name, description, status, created_at)
      VALUES (${testFolder.id}, ${testFolder.name}, ${testFolder.description}, ${testFolder.status}, ${testFolder.createdAt})
    `);
    
    console.log('✅ Test insert successful');
    
    // Supprimer le dossier de test
    await db.run(sql`DELETE FROM folders WHERE id = ${testFolder.id}`);
    console.log('✅ Test cleanup successful');
    
  } catch (error) {
    console.error('❌ Error:', error);
    
    // Si la colonne status n'existe pas, l'ajouter
    if (error.message?.includes('no such column: status')) {
      console.log('Adding status column...');
      await db.run(sql`ALTER TABLE folders ADD COLUMN status TEXT DEFAULT 'completed'`);
      console.log('✅ Status column added');
    }
  }
}

// Exécuter la vérification
checkFolderTable()
  .then(() => {
    console.log('Check completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Check failed:', error);
    process.exit(1);
  });
