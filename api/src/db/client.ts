import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { env } from '../config/env';

const databaseFile = env.DATABASE_URL.replace('sqlite://', '');

export const sqlite = new Database(databaseFile);
export const db = drizzle(sqlite);
