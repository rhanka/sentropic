import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { env } from '../config/env';

// Expect DATABASE_URL like: postgres://user:pass@host:5432/db
const connectionString = env.DATABASE_URL;

// Minimal pool; serverless-friendly
const pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 10_000 });

const pgDb = drizzle(pool);

// Backward-compat helpers: provide .all/.run used in existing code paths
// Map to drizzle execute() which returns rows array for raw SQL
const compatDb: typeof pgDb & { all?: any; run?: any } = pgDb as any;
compatDb.all = async (query: any) => {
  // drizzle sql`` returns a Query; execute returns rows
  // @ts-ignore
  return await pgDb.execute(query);
};
compatDb.run = async (query: any) => {
  // For non-select, still execute; caller usually ignores return structure
  // @ts-ignore
  return await pgDb.execute(query);
};

export const db = compatDb;
export { pool };
