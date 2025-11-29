#!/usr/bin/env tsx

/**
 * Script pour créer les index recommandés pour use_cases
 * 
 * Ce script utilise la fonction ensureIndexes() du module db/ensure-indexes.ts
 * pour créer les index de manière idempotente.
 * 
 * Usage: tsx src/scripts/db-create-indexes.ts
 */

import { ensureIndexes } from '../db/ensure-indexes';
import { pool } from '../db/client';

async function main() {
  console.log('🔄 Création des index pour use_cases...');
  try {
    await ensureIndexes();
    console.log('✅ Tous les index ont été créés avec succès');
  } catch (error) {
    console.error('❌ Erreur lors de la création des index:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();

