import { afterAll } from 'vitest';
import { flushCleanups } from './cleanup-registry.js';

if (!process.env.CM_PG_URL) throw new Error('PostgreSQL identity qualification requires CM_PG_URL');

afterAll(() => flushCleanups());
