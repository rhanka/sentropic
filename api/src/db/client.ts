import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { env } from '../config/env';

// Expect DATABASE_URL like: postgres://user:pass@host:5432/db[?ssl=true&options=databaseid%3D<id>]
const connectionString = env.DATABASE_URL;

// SSL & options handling (local vs serverless):
// - Local Postgres: no ssl (default)
// - Serverless (Scaleway): ssl required + databaseid option (via URL ?options=databaseid%3D<id> ou PGOPTIONS)
let ssl: false | { rejectUnauthorized: boolean; servername?: string } = false;
let pgOptions: string | undefined = undefined;

try {
  const url = new URL(connectionString);
  const sslParam = url.searchParams.get('ssl');
  const forceSSL = (sslParam && sslParam.toLowerCase() === 'true') || process.env.PGSSLMODE === 'require';
  if (forceSSL) {
    ssl = {
      // Scaleway utilise un certificat public; on peut laisser true. Autoriser false via env si besoin de debug.
      rejectUnauthorized: (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'true') !== 'false',
      servername: url.hostname
    };
  }
  pgOptions = url.searchParams.get('options') || process.env.PGOPTIONS || undefined;
  if (!pgOptions && process.env.SCW_DB_ID) {
    // Compat Scaleway: passer l'identifiant DB via PG options
    pgOptions = `-cdatabaseid=${process.env.SCW_DB_ID}`;
  }
} catch {
  // Si l'URL n'est pas parseable, rester en config minimale
}

// Minimal pool; serverless-friendly
const pool = new Pool({ connectionString, ssl, ...(pgOptions ? { options: pgOptions } : {}), max: 10, idleTimeoutMillis: 10_000 });

const pgDb = drizzle(pool);

// Backward-compat helpers: provide .all/.run used in existing code paths
// Map to drizzle execute() which returns rows array for raw SQL
type CompatDbMethods = {
  all: (query: SQL) => Promise<unknown[]>;
  run: (query: SQL) => Promise<unknown>;
  get: (query: SQL) => Promise<unknown | undefined>;
};

type CompatDb = typeof pgDb & CompatDbMethods;

const compatDb = pgDb as CompatDb;
compatDb.all = async (query: SQL): Promise<unknown[]> => {
  // drizzle sql`` returns a Query; execute returns { rows }
  const res: { rows?: unknown[] } | unknown[] = await pgDb.execute(query);
  if (res && typeof res === 'object' && 'rows' in res && Array.isArray(res.rows)) return res.rows;
  if (Array.isArray(res)) return res;
  return [];
};
compatDb.run = async (query: SQL): Promise<unknown> => {
  // For non-select, still execute; caller usually ignores return structure
  return await pgDb.execute(query);
};

compatDb.get = async (query: SQL): Promise<unknown | undefined> => {
  // Execute and return first row or undefined
  const res: { rows?: unknown[] } | unknown[] = await pgDb.execute(query);
  // drizzle execute on node-postgres returns { rows }
  if (res && typeof res === 'object' && 'rows' in res && Array.isArray(res.rows)) {
    return res.rows[0];
  }
  // Some cases (our all shim) might return an array directly
  if (Array.isArray(res)) return res[0];
  return undefined;
};

export const db = compatDb;
export { pool };
