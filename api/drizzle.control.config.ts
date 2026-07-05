import type { Config } from 'drizzle-kit';

export default {
  schema: './src/db/control-schema.ts',
  out: './drizzle/control',
  dialect: 'postgresql',
  schemaFilter: ['control'],
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://app:app@localhost:5432/app'
  }
} satisfies Config;
