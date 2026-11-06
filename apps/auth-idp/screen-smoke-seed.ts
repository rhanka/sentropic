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

import { createCmUser } from '../../api/src/services/identity/cm-users';
import { createSession } from '../../api/src/services/session-manager';

const TEST_EMAIL = process.env.SCREEN_SMOKE_EMAIL ?? 'idp-screen-smoke@example.com';

const failSeed = (msg: string): never => {
  console.error(`SCREEN-SMOKE-SEED FAIL: ${msg}`);
  process.exit(1);
};

const main = async (): Promise<void> => {
  // CM-native user creation: the raw account/profile upserts used before left
  // no identity_subject_fences row, so session minting failed closed
  // (identity_material_missing). createCmUser enrolls the full material.
  const created = await createCmUser({ email: TEST_EMAIL, displayName: 'IdP Screen Smoke',
    role: 'editor', emailVerified: true, accountStatus: 'active' });
  const seededUserId = created.id;

  const session = await createSession(seededUserId, 'editor', { name: 'idp-screen-smoke' });
  // Machine-readable lines for the Playwright step to capture.
  console.log(`USER_ID=${seededUserId}`);
  console.log(`SESSION_TOKEN=${session.sessionToken}`);
  process.exit(0);
};

main().catch((err) => {
  console.error(`SCREEN-SMOKE-SEED FAIL: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  process.exit(1);
});
