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

import { eq } from 'drizzle-orm';

import { db } from '../../api/src/db/client';
import { users } from '../../api/src/db/schema';
import { createSession } from '../../api/src/services/session-manager';

const TEST_EMAIL = process.env.SCREEN_SMOKE_EMAIL ?? 'idp-screen-smoke@example.com';
const TEST_NAME = 'IdP Screen Smoke User';

const main = async (): Promise<void> => {
  const now = new Date();
  const userId = `idp-screen-${randomUUID()}`;
  await db
    .insert(users)
    .values({
      id: userId,
      email: TEST_EMAIL,
      displayName: TEST_NAME,
      role: 'editor',
      accountStatus: 'active',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      set: { accountStatus: 'active', displayName: TEST_NAME, emailVerified: true, updatedAt: now },
      target: users.email,
    });

  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_EMAIL)).limit(1);
  if (!row) {
    console.error('SCREEN-SMOKE-SEED FAIL: seeded user not found after upsert');
    process.exit(1);
  }
  const session = await createSession(row.id, 'editor', { name: 'idp-screen-smoke' });
  // Machine-readable lines for the Playwright step to capture.
  console.log(`USER_ID=${row.id}`);
  console.log(`SESSION_TOKEN=${session.sessionToken}`);
  process.exit(0);
};

main().catch((err) => {
  console.error(`SCREEN-SMOKE-SEED FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
