import { db } from '../db/client';
import { sql } from 'drizzle-orm';

async function createSettingsTable() {
  console.log('Creating settings table...');
  try {
    await db.run(sql`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insérer les paramètres par défaut
    await db.run(sql`
      INSERT OR IGNORE INTO settings (key, value, description) VALUES
      ('ai_concurrency', '10', 'Nombre de jobs IA simultanés'),
      ('default_model', 'gpt-5', 'Modèle OpenAI par défaut'),
      ('queue_processing_interval', '5000', 'Intervalle de traitement de la queue (ms)')
    `);
    
    console.log('✅ Settings table created successfully');
  } catch (error: any) {
    if (error.message.includes('table settings already exists')) {
      console.log('Settings table already exists, skipping.');
    } else {
      console.error('❌ Error creating settings table:', error);
      throw error;
    }
  }
}

async function migrate() {
  await createSettingsTable();
  console.log('Migration completed successfully');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
