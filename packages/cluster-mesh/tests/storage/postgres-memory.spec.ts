// Enroll the memory corpus in the existing E2 PostgreSQL inventory.
// The qualification lane supplies CM_PG_URL; missing PG must fail that lane.
import { beforeAll } from 'vitest';
import '../engram-memory/postgres-registration.spec.js';
import '../engram-memory/projection.spec.js';
import '../engram-memory/queries.spec.js';

beforeAll(() => {
  if (!process.env.CM_PG_URL) throw new Error('memory PostgreSQL qualification requires CM_PG_URL');
});
