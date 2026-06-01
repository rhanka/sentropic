#!/usr/bin/env tsx

import { pool } from '../db/client';
import { seedOAuthClients } from '../services/auth/oauth-client-seed';

try {
  const clients = await seedOAuthClients();
  console.log(`Seeded ${clients.length} OAuth client(s):`);
  for (const client of clients) {
    console.log(`- ${client.clientId} (${client.dpopBoundAccessTokens ? 'DPoP' : 'Bearer'})`);
  }
} catch (error) {
  console.error('Failed to seed OAuth clients:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
