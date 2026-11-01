import { afterAll } from 'vitest';
import { flushCleanups } from './cleanup-registry.js';

afterAll(() => flushCleanups());
