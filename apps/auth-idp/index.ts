// PLACEHOLDER LOCATION (BR-39m / fork F5) — see idp-app.ts header.
//
// Phase A0 standalone IdP server entry. It serves the composed IdP app
// (`createIdpApp`) on its own port. It REUSES the shared DB and the existing
// api migration ownership: in Phase A0 the IdP runs from the existing api image
// alongside the product API, so schema migrations are already applied by
// `api/src/index.ts`. This entry therefore does NOT run migrations (no new DB,
// no schema change) — it only boots the HTTP listener for the IdP surface.
//
// Reversibility: this file has no schema/data side effects; deleting it removes
// the standalone listener with the product API untouched.

import { serve } from '@hono/node-server';

import { env } from '../../api/src/config/env';
import { logger } from '../../api/src/logger';
import { createIdpApp } from './idp-app';

// Dedicated IdP port. Falls back to the product API port only for local
// convenience; in deployment the IdP gets its own port/origin (auth.sent-tech.ca).
const port = Number(process.env.IDP_PORT ?? process.env.API_PORT ?? env.PORT);

const app = createIdpApp();

serve({ fetch: app.fetch, port });
logger.info(`Standalone IdP (PLACEHOLDER auth-idp) listening on http://0.0.0.0:${port}`);
