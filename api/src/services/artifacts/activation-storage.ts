import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPostgresActivationStore, ACTIVATION_MAX_TTL_SECONDS, ACTIVATION_SQL_ASSET,
  ACTIVATION_SQL_ASSET_SHA256, type BrowserFlowBinding } from '@sentropic/artifacts/adapters/postgres-activation';
import { artifactMigrationAssets } from './host-storage';

export { ActivationCommitUnknownError } from '@sentropic/artifacts/adapters/postgres-activation';

/** Trusted host configuration only; W3 owns current authority and browser effects. */
export async function createArtifactHostActivationStorage(options: {
  pool: Pool;
  namespace: string;
  ticketTtlSeconds: number;
  flowTtlSeconds: number;
}) {
  const { pool, namespace, ticketTtlSeconds, flowTtlSeconds } = options;
  if ([ticketTtlSeconds, flowTtlSeconds].some(ttl => !Number.isSafeInteger(ttl) ||
    ttl <= 0 || ttl > ACTIVATION_MAX_TTL_SECONDS) || flowTtlSeconds > ticketTtlSeconds) {
    throw new Error('Invalid artifact activation lifetime');
  }
  const store = createPostgresActivationStore({ pool, namespace });
  const asset = artifactMigrationAssets.find(asset => asset.id === ACTIVATION_SQL_ASSET);
  if (!asset || createHash('sha256').update(asset.read()).digest('hex') !== ACTIVATION_SQL_ASSET_SHA256) {
    throw new Error('Artifact activation asset hash mismatch');
  }
  const { rows } = await pool.query<{ hash: string }>(
    'SELECT hash FROM public.__drizzle_control_migrations WHERE asset_id = $1', [ACTIVATION_SQL_ASSET]);
  if (rows.length !== 1 || rows[0].hash !== ACTIVATION_SQL_ASSET_SHA256) {
    throw new Error('Artifact activation migration receipt mismatch');
  }
  return Object.freeze({ ...store,
    async issue(binding: BrowserFlowBinding) {
      const snapshot = { ...binding };
      const ticket = await store.tickets.issue!({ ...snapshot, ticketId: randomUUID() }, ticketTtlSeconds * 1000);
      // Both deadlines derive from the package's PostgreSQL issuance time, never the host clock.
      const flow = { ...snapshot, ...ticket, flowId: randomUUID(),
        expiresAt: ticket.expiresAt - (ticketTtlSeconds - flowTtlSeconds) * 1000 };
      await store.flows.put(flow);
      return { ticket, flow };
    },
  });
}
