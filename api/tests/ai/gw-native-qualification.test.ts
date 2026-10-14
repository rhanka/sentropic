import { it } from 'vitest';
import { qualificationSelected } from '../../src/services/llm-runtime/gw-native-qualification-cap';

it.skipIf(!qualificationSelected(process.env.SCOPE))('should qualify the isolated native listener', async () => {
  // Readiness belongs inside this exact-SCOPE gate; no app/auth/cleanup import is permitted.
  const { qualificationEnvironment, openQualificationDb, checkQualificationReadiness } = await import('./gw-native-qualification-readiness');
  const { token, database } = qualificationEnvironment();
  const db = await openQualificationDb(database);
  try { await checkQualificationReadiness(db, token); throw new Error('Qualification case runner build is incomplete'); }
  finally { await db.end(); }
});
