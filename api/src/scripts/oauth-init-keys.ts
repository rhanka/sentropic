#!/usr/bin/env tsx

import { pool } from '../db/client';
import { createJwksAdapter } from '../services/auth/jwks-adapter';

try {
  const jwks = createJwksAdapter();
  const active = await jwks.getActiveKey();

  if (active) {
    console.log(`OAuth signing key already initialized: ${active.kid}`);
  } else {
    const created = await jwks.generateAndStoreNewKey();
    console.log(`OAuth signing key initialized: ${created.kid}`);
  }
} catch (error) {
  console.error('Failed to initialize OAuth signing key:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
