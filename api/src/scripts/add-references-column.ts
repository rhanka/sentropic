import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function addReferencesColumn() {
  try {
    console.log('🔄 Ajout de la colonne references à la table use_cases...');
    
    await db.run(sql`
      ALTER TABLE use_cases ADD COLUMN "references" TEXT DEFAULT '[]'
    `);
    
    console.log('✅ Colonne references ajoutée avec succès');
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate column name')) {
      console.log('ℹ️ La colonne references existe déjà');
    } else {
      console.error('❌ Erreur lors de l\'ajout de la colonne:', error);
      throw error;
    }
  }
}

// Exécuter la migration si le script est appelé directement
if (import.meta.url === `file://${process.argv[1]}`) {
  addReferencesColumn()
    .then(() => {
      console.log('🎉 Migration terminée');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Échec de la migration:', error);
      process.exit(1);
    });
}

export { addReferencesColumn };
