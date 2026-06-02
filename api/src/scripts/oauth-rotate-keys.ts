#!/usr/bin/env tsx

import { pool } from '../db/client';
import { createJwksAdapter } from '../services/auth/jwks-adapter';

try {
  const jwks = createJwksAdapter();
  const active = await jwks.getActiveKey();

  if (!active) {
    console.error(
      'No active signing key found. Run `npm run oauth:init-keys` first.'
    );
    process.exitCode = 1;
  } else {
    const created = await jwks.generateAndStoreNewKey();
    console.log(
      `OAuth signing key rotated. Old kid: ${active.kid} (now active=false, stays in JWKS ≥65 min). New kid: ${created.kid} (active=true).`
    );
  }
} catch (error) {
  console.error('Failed to rotate OAuth signing key:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
