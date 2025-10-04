import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: getTestInclude(),
    exclude: ['node_modules', 'dist'],
    testTimeout: 30000, // 30s pour les tests IA
    hookTimeout: 10000, // 10s pour les hooks
  },
});

function getTestInclude(): string[] {
  const { TEST_FILTER, TEST_ENDPOINT, TEST_METHOD, TEST_TYPE, TEST_MODEL, TEST_JOB_TYPE, TEST_SUITE } = process.env;
  
  // Si un filtre spécifique est demandé
  if (TEST_FILTER) {
    return [`tests/**/${TEST_FILTER}*.test.ts`];
  }
  
  // Si une suite spécifique est demandée
  if (TEST_SUITE) {
    const suites = TEST_SUITE.split(',');
    return suites.map(suite => `tests/${suite}/**/*.test.ts`);
  }
  
  // Filtres par type de test
  if (TEST_TYPE) {
    return [`tests/ai/*${TEST_TYPE}*.test.ts`];
  }
  
  if (TEST_ENDPOINT) {
    return [`tests/api/*${TEST_ENDPOINT}*.test.ts`];
  }
  
  if (TEST_JOB_TYPE) {
    return [`tests/queue/*${TEST_JOB_TYPE}*.test.ts`];
  }
  
  // Par défaut, tous les tests
  return ['tests/**/*.test.ts'];
}
