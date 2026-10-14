import { it } from 'vitest';
import { qualificationSelected } from '../../src/services/llm-runtime/gw-native-qualification-cap';

it.skipIf(!qualificationSelected(process.env.SCOPE))('should qualify the isolated native listener', async () => {
  // Readiness belongs inside this exact-SCOPE gate; no app/auth/cleanup import is permitted.
  throw new Error('Qualification harness build is incomplete');
});
