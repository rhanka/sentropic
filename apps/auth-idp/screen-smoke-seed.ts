// BR-39m A0-bis — seed step for the screen-driven IdP smoke.
//
// Runs inside the api workspace (has the shared DB client + session manager).
// Mints a verified test user + an app-owned session token against the SHARED DB
// and prints `USER_ID=<id>` and `SESSION_TOKEN=<token>` on stdout so the
// Playwright step (which has a browser but no DB client) can inject the session
// cookie at the IdP origin and drive the served consent screen deterministically.
//
// Why a separate step: the screen smoke needs BOTH a browser (Playwright) and a
// DB seed; those live in different images. We seed here (api image) and hand the
// session token to the browser step (e2e/playwright image) — no WebAuthn, no
// maildev, fully deterministic.

import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';

import { db } from '../../api/src/db/client';
import { createSession } from '../../api/src/services/session-manager';

const TEST_EMAIL = process.env.SCREEN_SMOKE_EMAIL ?? 'idp-screen-smoke@example.com';

const main = async (): Promise<void> => {
  const now = new Date().toISOString();
  const userId = `idp-screen-${randomUUID()}`;
  await db.execute(sql`INSERT INTO cm_identity.identity_user_accounts
    (user_id, email, account_status, global_role, created_at, updated_at)
    VALUES (${userId}, ${TEST_EMAIL}, 'active', 'editor', ${now}, ${now})
    ON CONFLICT (email) DO UPDATE SET account_status = 'active', updated_at = ${now}`);
  const found = await db.execute(
    sql`SELECT user_id FROM cm_identity.identity_user_accounts WHERE email = ${TEST_EMAIL} LIMIT 1`);
  const row = found.rows[0];
  if (!row) {
    console.error('SCREEN-SMOKE-SEED FAIL: seeded user not found after upsert');
    process.exit(1);
  }
  await db.execute(sql`INSERT INTO cm_identity.identity_account_profiles
    (user_id, email_verified, legacy_account_status) VALUES (${row.user_id}, true, 'active')
    ON CONFLICT (user_id) DO UPDATE SET email_verified = true, legacy_account_status = 'active'`);

  const session = await createSession(row.user_id, 'editor', { name: 'idp-screen-smoke' });
  // Machine-readable lines for the Playwright step to capture.
  console.log(`USER_ID=${row.user_id}`);
  console.log(`SESSION_TOKEN=${session.sessionToken}`);
  process.exit(0);
};

main().catch((err) => {
  console.error(`SCREEN-SMOKE-SEED FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
