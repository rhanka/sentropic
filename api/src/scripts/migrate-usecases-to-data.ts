/**
 * Script de migration des données use_cases vers le champ data JSONB
 * 
 * Ce script migre toutes les colonnes métier vers data JSONB, en conservant
 * name et description en colonnes natives.
 * 
 * Usage: tsx src/scripts/migrate-usecases-to-data.ts
 */

import { pool } from '../db/client';

async function migrateUseCasesToData() {

  console.log('🔄 Début de la migration des données use_cases vers data JSONB...');

  try {
    // Vérifier que la colonne data existe
    const checkDataColumn = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'use_cases' AND column_name = 'data'
    `);

    if (checkDataColumn.rows.length === 0) {
      throw new Error(`La colonne "data" n'existe pas. Exécutez d'abord la migration Drizzle.`);
    }

    console.log('✅ Colonne data trouvée');

    // Compter les cas d'usage à migrer
    const countResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM use_cases 
      WHERE data = '{}'::jsonb OR data IS NULL
    `);
    const count = parseInt(countResult.rows[0].count);
    console.log(`📊 ${count} cas d'usage à migrer`);

    if (count === 0) {
      console.log('✅ Aucune migration nécessaire, toutes les données sont déjà migrées');
      return;
    }

    // Migrer les données
    const result = await pool.query(`
      UPDATE use_cases 
      SET "data" = jsonb_build_object(
        'process', COALESCE("process", NULL),
        'domain', COALESCE("domain", NULL),
        'technologies', COALESCE("technologies"::jsonb, '[]'::jsonb),
        'prerequisites', COALESCE("prerequisites", NULL),
        'deadline', COALESCE("deadline", NULL),
        'contact', COALESCE("contact", NULL),
        'benefits', COALESCE("benefits"::jsonb, '[]'::jsonb),
        'metrics', COALESCE("metrics"::jsonb, '[]'::jsonb),
        'risks', COALESCE("risks"::jsonb, '[]'::jsonb),
        'nextSteps', COALESCE("next_steps"::jsonb, '[]'::jsonb),
        'dataSources', COALESCE("data_sources"::jsonb, '[]'::jsonb),
        'dataObjects', COALESCE("data_objects"::jsonb, '[]'::jsonb),
        'references', COALESCE("references"::jsonb, '[]'::jsonb),
        'valueScores', COALESCE("value_scores"::jsonb, '[]'::jsonb),
        'complexityScores', COALESCE("complexity_scores"::jsonb, '[]'::jsonb)
      )
      WHERE "data" = '{}'::jsonb OR "data" IS NULL
    `);

    console.log(`✅ ${result.rowCount} cas d'usage migrés avec succès`);

    // Vérifier la migration
    const verifyResult = await pool.query(`
      SELECT COUNT(*) as count 
      FROM use_cases 
      WHERE "data" = '{}'::jsonb OR "data" IS NULL
    `);
    const remaining = parseInt(verifyResult.rows[0].count);

    if (remaining > 0) {
      console.warn(`⚠️  ${remaining} cas d'usage n'ont pas été migrés`);
    } else {
      console.log(`✅ Tous les cas d'usage ont été migrés`);
    }

    // Afficher un exemple de données migrées
    const exampleResult = await pool.query(`
      SELECT id, name, "data" 
      FROM use_cases 
      WHERE "data" != '{}'::jsonb 
      LIMIT 1
    `);

    if (exampleResult.rows.length > 0) {
      console.log('\n📋 Exemple de données migrées:');
      console.log(JSON.stringify(exampleResult.rows[0], null, 2));
    }

  } catch (error) {
    console.error('❌ Erreur lors de la migration:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Exécuter la migration
migrateUseCasesToData()
  .then(() => {
    console.log('✅ Migration terminée');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Échec de la migration:', error);
    process.exit(1);
  });

