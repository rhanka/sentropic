import { db } from '../db/client.js';
import { organizations, folders, initiatives } from '../db/schema.js';

async function extractTestData() {
  console.log('🔍 Extracting test data from existing database...\n');

  try {
    // Récupérer toutes les organisations
    const organizationsData = await db.select().from(organizations);
    console.log('=== ORGANIZATIONS ===');
    organizationsData.forEach((org, index) => {
      console.log(`Organization ${index + 1}:`);
      console.log(JSON.stringify(org, null, 2));
      console.log('');
    });

    // Récupérer tous les dossiers
    const foldersData = await db.select().from(folders);
    console.log('=== FOLDERS ===');
    foldersData.forEach((folder, index) => {
      console.log(`Folder ${index + 1}:`);
      console.log(JSON.stringify(folder, null, 2));
      console.log('');
    });

    // Récupérer tous les cas d'usage
    const initiativesData = await db.select().from(initiatives);
    console.log('=== USE CASES ===');
    initiativesData.forEach((initiative, index) => {
      console.log(`Use Case ${index + 1}:`);
      console.log(JSON.stringify(initiative, null, 2));
      console.log('');
    });

    // Identifier Rio Tinto et Delpharm
    const rioTinto = organizationsData.find((o) => o.name?.toLowerCase().includes('rio tinto'));
    const delpharm = organizationsData.find((o) => o.name?.toLowerCase().includes('delpharm'));

    console.log('=== IDENTIFIED ORGANIZATIONS ===');
    if (rioTinto) {
      console.log('Rio Tinto found:', rioTinto.id);
    }
    if (delpharm) {
      console.log('Delpharm found:', delpharm.id);
    }

    // Trouver les cas d'usage liés à Rio Tinto
    if (rioTinto) {
      type InitiativeRowLike = { organizationId?: string | null };
      const rioTintoInitiatives = initiativesData.filter((uc) => {
        const row = uc as unknown as InitiativeRowLike;
        return row.organizationId === rioTinto.id;
      });
      console.log(`\nRio Tinto initiatives: ${rioTintoInitiatives.length}`);
    }

  } catch (error) {
    console.error('Error extracting data:', error);
  } finally {
    process.exit(0);
  }
}

extractTestData();
