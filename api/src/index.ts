import { env } from './config/env';
import { logger } from './logger';
import { runMigrations } from './db/run-migrations';
import { ensureIndexes } from './db/ensure-indexes';
import { db, pool } from './db/client';
import { objectLocks } from './db/schema';
import { purgeExpiredAuthData } from './services/challenge-purge';
import { ensureAdminWorkspaceExists, claimAdminWorkspaceOwner } from './services/workspace-service';
import { runAdminApprovalSweep } from './services/admin-approval-sweep';
import { runChatTracePurge } from './services/chat-trace-sweep';
import { runQueueReaperSweep } from './services/queue-reaper-sweep';
import { runStreamEventsPurge } from './services/chat/stream-purge-sweep';
import { outboxDispatcher } from './services/outbox/outbox-dispatcher';
import { createJwksAdapter } from './services/auth/jwks-adapter';
import { lt } from 'drizzle-orm';

const port = env.PORT;

type LockObjectType = 'organization' | 'folder' | 'initiative';

async function notifyLockEvent(workspaceId: string, objectType: LockObjectType, objectId: string): Promise<void> {
  const payload = JSON.stringify({
    workspace_id: workspaceId,
    object_type: objectType,
    object_id: objectId,
  }).replace(/'/g, "''");

  const client = await pool.connect();
  try {
    await client.query(`NOTIFY lock_events, '${payload}'`);
  } finally {
    client.release();
  }
}

async function purgeAllLocksAtStartup(): Promise<void> {
  const rows = await db
    .select({
      workspaceId: objectLocks.workspaceId,
      objectType: objectLocks.objectType,
      objectId: objectLocks.objectId,
    })
    .from(objectLocks);

  if (!rows.length) return;
  await db.delete(objectLocks);
  await Promise.all(
    rows.map((row) => notifyLockEvent(row.workspaceId, row.objectType as LockObjectType, row.objectId))
  );
}

async function purgeExpiredLocksSweep(): Promise<number> {
  const now = new Date();
  const rows = await db
    .select({
      workspaceId: objectLocks.workspaceId,
      objectType: objectLocks.objectType,
      objectId: objectLocks.objectId,
    })
    .from(objectLocks)
    .where(lt(objectLocks.expiresAt, now));

  if (!rows.length) return 0;
  await db.delete(objectLocks).where(lt(objectLocks.expiresAt, now));
  await Promise.all(
    rows.map((row) => notifyLockEvent(row.workspaceId, row.objectType as LockObjectType, row.objectId))
  );
  return rows.length;
}

// Run database migrations at boot (idempotent)
try {
  logger.info('Running database migrations at startup...');
  await runMigrations();
  logger.info('Database migrations completed.');
} catch (error) {
  logger.error({ err: error }, 'Database migration failed at startup');
  process.exit(1);
}

// Ensure indexes exist at boot (idempotent)
try {
  logger.info('Ensuring database indexes at startup...');
  await ensureIndexes();
  logger.info('Database indexes ensured.');
} catch (error) {
  logger.error({ err: error }, 'Database index creation failed at startup');
  process.exit(1);
}

// Ensure an OAuth/OIDC signing key exists at boot (idempotent; mirrors the migration
// pattern above). The api owns shared-DB initialization; the standalone IdP reads the
// same JWKS rows. The prod image prunes devDependencies (no `tsx`), so the dev-only
// `oauth:init-keys` script cannot run in-cluster — boot-time init is the prod path.
// Guarded by the KEK: signing keys are encrypted at rest with OAUTH_SIGNING_KEK, so
// when it is absent we skip (OAuth/OIDC simply has no active key) instead of crashing —
// every non-OAuth route stays up. A failure here is logged but never fatal.
if (env.OAUTH_SIGNING_KEK) {
  try {
    const jwks = createJwksAdapter();
    const active = await jwks.getActiveKey();
    if (active) {
      logger.info({ kid: active.kid }, 'OAuth signing key already present.');
    } else {
      const created = await jwks.generateAndStoreNewKey();
      logger.info({ kid: created.kid }, 'OAuth signing key initialized at startup.');
    }
  } catch (error) {
    logger.error({ err: error }, 'OAuth signing key init failed at startup (OAuth/OIDC unavailable until resolved).');
  }
} else {
  logger.warn('OAUTH_SIGNING_KEK not set — skipping OAuth signing key init (OAuth/OIDC has no active signing key).');
}

// Purge expired authentication data (challenges, magic links)
try {
  await purgeExpiredAuthData();
} catch (error) {
  logger.error({ err: error }, 'Failed to purge expired auth data at startup, continuing anyway');
  // Non-critical: don't block startup if purge fails
}

// Ensure Admin Workspace exists (idempotent) and is claimed by admin_app if present
try {
  await ensureAdminWorkspaceExists();
  await claimAdminWorkspaceOwner();
} catch (error) {
  logger.error({ err: error }, 'Failed to ensure admin workspace at startup, continuing anyway');
}

// Purge all locks at startup (safety: locks are session-scoped)
try {
  await purgeAllLocksAtStartup();
} catch (error) {
  logger.error({ err: error }, 'Failed to purge locks at startup, continuing anyway');
}

// Admin approval sweep (48h -> read-only). Run once at boot, then periodically.
if (process.env.NODE_ENV !== 'test') {
  try {
    await runAdminApprovalSweep();
  } catch (error) {
    logger.error({ err: error }, 'Admin approval sweep failed at startup, continuing anyway');
  }

  setInterval(() => {
    runAdminApprovalSweep().catch((error) => {
      logger.error({ err: error }, 'Admin approval sweep failed');
    });
  }, 15 * 60 * 1000); // every 15 minutes

  // Chat trace purge (retention > 7 days). Run once at boot, then daily.
  try {
    await runChatTracePurge();
  } catch {
    // already logged inside
  }
  setInterval(() => {
    void runChatTracePurge();
  }, 24 * 60 * 60 * 1000);

  // Lock expiry sweep (short TTL). Purge expired locks and notify via SSE.
  setInterval(() => {
    purgeExpiredLocksSweep().catch((error) => {
      logger.error({ err: error }, 'Lock expiry sweep failed');
    });
  }, 30 * 1000);

  // Queue reaper (WI-1): recover stranded `processing` jobs at boot (before any
  // local jobs start → liveJobIds=[]) then every 5 minutes with live ids excluded.
  // Boot sweep runs before any local job starts, so no live ids to skip.
  await runQueueReaperSweep([]);
  setInterval(() => {
    // Import queueManager lazily to avoid circular-import at module load time.
    import('./services/queue-manager').then(({ queueManager }) => {
      const liveIds = Array.from(queueManager.getLiveJobIds());
      void runQueueReaperSweep(liveIds);
    }).catch((error) => {
      logger.error({ err: error }, 'Queue reaper periodic sweep failed');
    });
  }, 5 * 60 * 1000); // every 5 minutes

  // Stream events purge (WI-2): purge old chat_stream_events at boot, then daily.
  try {
    await runStreamEventsPurge();
  } catch {
    // already logged inside
  }
  setInterval(() => {
    void runStreamEventsPurge();
  }, 24 * 60 * 60 * 1000);

  // Outbox dispatcher (BR-60 ARCH-14): LISTEN outbox_pending + periodic sweep.
  // Claims control.event_outbox pending rows and emits via EventBusPort (pg NOTIFY).
  try {
    await outboxDispatcher.start();
  } catch (error) {
    logger.error({ err: error }, 'Outbox dispatcher failed to start');
  }
}

const [{ serve }, { app }] = await Promise.all([
  import('@hono/node-server'),
  import('./app')
]);

serve({ fetch: app.fetch, port });
logger.info(`API server listening on http://0.0.0.0:${port}`);
