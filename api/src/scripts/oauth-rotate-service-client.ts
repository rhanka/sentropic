#!/usr/bin/env tsx

import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { db } from '../db/client';
import { pool } from '../db/client';
import { serviceClients } from '../db/schema';

const clientId = process.env.CLIENT_ID;

const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

try {
  if (!clientId) {
    console.error('CLIENT_ID is required: make oauth-rotate-service-client CLIENT_ID=<id> ENV=<env>');
    process.exitCode = 1;
  } else {
    const newSecret = randomBytes(32).toString('base64url');
    const now = new Date();

    const [updated] = await db
      .update(serviceClients)
      .set({ clientSecretHash: hashSecret(newSecret), secretRotatedAt: now })
      .where(and(eq(serviceClients.clientId, clientId), isNull(serviceClients.revokedAt)))
      .returning({ clientId: serviceClients.clientId });

    if (!updated) {
      console.error(`No active service client found for CLIENT_ID=${clientId}.`);
      process.exitCode = 1;
    } else {
      // BR39d-D2: single-secret immediate cutover. Print once; the operator must
      // redeploy consumers with the new secret. No grace window (deferred to 39g/39h).
      console.log(`Service client secret rotated for ${clientId} (secret_rotated_at=${now.toISOString()}).`);
      console.log('New secret (shown once — store it securely now):');
      console.log(newSecret);
    }
  }
} catch (error) {
  console.error('Failed to rotate service client secret:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
