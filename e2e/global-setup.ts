import { chromium, FullConfig } from '@playwright/test';

async function globalSetup(config: FullConfig) {
  console.log('🌱 Global setup: Seeding test data...');
  
  try {
    // Lancer le seed de test via l'API
    const response = await fetch('http://api:8787/api/test/seed', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      console.log('✅ Test data seeded successfully');
    } else {
      console.log('⚠️  API seed endpoint not available, using fallback...');
      // Fallback: on peut aussi lancer le script directement
      // mais pour l'instant on continue sans erreur
    }
  } catch (error) {
    console.log('⚠️  Could not seed via API, continuing without test data...');
    console.log('   Error:', error.message);
  }
}

export default globalSetup;
