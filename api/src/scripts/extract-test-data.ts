import { db } from '../db/client.js';
import { companies, folders, useCases } from '../db/schema.js';
import { eq } from 'drizzle-orm';

async function extractTestData() {
  console.log('🔍 Extracting test data from existing database...\n');

  try {
    // Récupérer toutes les entreprises
    const companiesData = await db.select().from(companies);
    console.log('=== COMPANIES ===');
    companiesData.forEach((company, index) => {
      console.log(`Company ${index + 1}:`);
      console.log(JSON.stringify(company, null, 2));
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
    const useCasesData = await db.select().from(useCases);
    console.log('=== USE CASES ===');
    useCasesData.forEach((useCase, index) => {
      console.log(`Use Case ${index + 1}:`);
      console.log(JSON.stringify(useCase, null, 2));
      console.log('');
    });

    // Identifier Rio Tinto et Delpharm
    const rioTinto = companiesData.find(c => c.name?.toLowerCase().includes('rio tinto'));
    const delpharm = companiesData.find(c => c.name?.toLowerCase().includes('delpharm'));

    console.log('=== IDENTIFIED COMPANIES ===');
    if (rioTinto) {
      console.log('Rio Tinto found:', rioTinto.id);
    }
    if (delpharm) {
      console.log('Delpharm found:', delpharm.id);
    }

    // Trouver les cas d'usage liés à Rio Tinto
    if (rioTinto) {
      const rioTintoUseCases = useCasesData.filter(uc => uc.companyId === rioTinto.id);
      console.log(`\nRio Tinto use cases: ${rioTintoUseCases.length}`);
    }

  } catch (error) {
    console.error('Error extracting data:', error);
  } finally {
    process.exit(0);
  }
}

extractTestData();
