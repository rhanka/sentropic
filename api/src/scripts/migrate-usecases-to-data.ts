/**
 * Script de migration des données use_cases vers le champ data JSONB
 * 
 * Ce script migre toutes les colonnes métier vers data JSONB, y compris
 * name et description (Phase 4 rework).
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

    // Vérifier si les colonnes name et description existent encore
    const checkNameColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'use_cases' AND column_name = 'name'
    `);
    const checkDescriptionColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'use_cases' AND column_name = 'description'
    `);
    
    const hasNameColumn = checkNameColumn.rows.length > 0;
    const hasDescriptionColumn = checkDescriptionColumn.rows.length > 0;
    
    console.log(`📊 Colonnes natives: name=${hasNameColumn ? 'présente' : 'absente'}, description=${hasDescriptionColumn ? 'présente' : 'absente'}`);

    // Compter les cas d'usage à migrer (ceux qui n'ont pas data.name ou data.description)
    let countQuery = `
      SELECT COUNT(*) as count 
      FROM use_cases 
      WHERE ("data"->>'name' IS NULL OR "data"->>'description' IS NULL)
    `;
    if (hasNameColumn) {
      countQuery += ` OR ("name" IS NOT NULL AND ("data"->>'name' IS NULL))`;
    }
    if (hasDescriptionColumn) {
      countQuery += ` OR ("description" IS NOT NULL AND ("data"->>'description' IS NULL))`;
    }
    const countResult = await pool.query(countQuery);
    const count = parseInt(countResult.rows[0].count);
    console.log(`📊 ${count} cas d'usage à migrer (name/description vers data)`);

    if (count === 0) {
      console.log('✅ Aucune migration nécessaire, toutes les données sont déjà migrées');
      return;
    }

    // Migrer les données : déplacer name et description vers data, préserver les données existantes dans data
    let updateQuery = '';
    if (hasNameColumn && hasDescriptionColumn) {
      // Les deux colonnes existent, les migrer vers data
      updateQuery = `
        UPDATE use_cases 
        SET "data" = COALESCE("data", '{}'::jsonb) || jsonb_build_object(
          'name', COALESCE("data"->>'name', "name"),
          'description', COALESCE("data"->>'description', "description"),
          'process', COALESCE("data"->>'process', "process"),
          'domain', COALESCE("data"->>'domain', "domain"),
          'technologies', COALESCE("data"->'technologies', COALESCE("technologies"::jsonb, '[]'::jsonb)),
          'prerequisites', COALESCE("data"->>'prerequisites', "prerequisites"),
          'deadline', COALESCE("data"->>'deadline', "deadline"),
          'contact', COALESCE("data"->>'contact', "contact"),
          'benefits', COALESCE("data"->'benefits', COALESCE("benefits"::jsonb, '[]'::jsonb)),
          'metrics', COALESCE("data"->'metrics', COALESCE("metrics"::jsonb, '[]'::jsonb)),
          'risks', COALESCE("data"->'risks', COALESCE("risks"::jsonb, '[]'::jsonb)),
          'nextSteps', COALESCE("data"->'nextSteps', COALESCE("next_steps"::jsonb, '[]'::jsonb)),
          'dataSources', COALESCE("data"->'dataSources', COALESCE("data_sources"::jsonb, '[]'::jsonb)),
          'dataObjects', COALESCE("data"->'dataObjects', COALESCE("data_objects"::jsonb, '[]'::jsonb)),
          'references', COALESCE("data"->'references', COALESCE("references"::jsonb, '[]'::jsonb)),
          'valueScores', COALESCE("data"->'valueScores', COALESCE("value_scores"::jsonb, '[]'::jsonb)),
          'complexityScores', COALESCE("data"->'complexityScores', COALESCE("complexity_scores"::jsonb, '[]'::jsonb))
        )
        WHERE ("data"->>'name' IS NULL OR "data"->>'description' IS NULL)
          OR ("name" IS NOT NULL AND ("data"->>'name' IS NULL))
          OR ("description" IS NOT NULL AND ("data"->>'description' IS NULL))
      `;
    } else if (hasNameColumn) {
      // Seule la colonne name existe
      updateQuery = `
        UPDATE use_cases 
        SET "data" = COALESCE("data", '{}'::jsonb) || jsonb_build_object(
          'name', COALESCE("data"->>'name', "name")
        )
        WHERE ("data"->>'name' IS NULL OR ("name" IS NOT NULL AND ("data"->>'name' IS NULL)))
      `;
    } else if (hasDescriptionColumn) {
      // Seule la colonne description existe
      updateQuery = `
        UPDATE use_cases 
        SET "data" = COALESCE("data", '{}'::jsonb) || jsonb_build_object(
          'description', COALESCE("data"->>'description', "description")
        )
        WHERE ("data"->>'description' IS NULL OR ("description" IS NOT NULL AND ("data"->>'description' IS NULL)))
      `;
    } else {
      // Aucune colonne native, migration déjà faite
      console.log('✅ Les colonnes name et description n\'existent plus, migration déjà effectuée');
      return;
    }

    const result = await pool.query(updateQuery);

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

