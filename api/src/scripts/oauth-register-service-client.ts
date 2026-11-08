#!/usr/bin/env tsx
//
// Governed, prod-safe provisioning of ONE `client_credentials` SERVICE client: the
// `service_clients` row (sha256-hashed secret, explicit scopes, RFC 8707 resource
// indicators, NO exchange policy, so client_credentials is granted) plus its CM tenant
// binding, in one serializable CM write. Never a manual SQL edit. Run it through
// `make oauth-register-service-client-job SECRET_FILE=<0600 env file> ENV=<env>`
// (Job 37-oauth-register-service-client-job.yaml). Procedure and 90-day cycle: docs/secrets.md.
//
// Required env: OAUTH_SERVICE_CLIENT_ID, OAUTH_SERVICE_CLIENT_SECRET (only its sha256 hash
// is stored; never printed), OAUTH_SERVICE_CLIENT_SCOPES (each in KNOWN_SERVICE_CLIENT_SCOPES).
// Optional env: OAUTH_SERVICE_CLIENT_NAME, OAUTH_SERVICE_CLIENT_RESOURCE_INDICATORS (default
// OAUTH_SERVICE_RESOURCE_URI, else AUTH_CALLBACK_BASE_URL), OAUTH_SERVICE_CLIENT_TENANT
// (default "sentropic"), OAUTH_SERVICE_CLIENT_DPOP, and the explicit change flags
// OAUTH_SERVICE_CLIENT_ALLOW_WIDEN / _ALLOW_DOWNGRADE / _ROTATE_SECRET (all "true"/"false").
//
// Idempotent: a replay with the same desired state writes nothing. Refusals (revoked row,
// exchange policy, reserved workload id, oauth_clients collision, tenant rebind, widen or
// downgrade or secret change without its flag) roll the whole write back.

import { pathToFileURL } from 'node:url';

import { oauthTenantStoreV1 } from '@sentropic/cluster-mesh';
import { eq } from 'drizzle-orm';

import { pool } from '../db/client';
import { oauthClients, serviceClients } from '../db/schema';
import {
  buildServiceClientRegistration,
  planServiceClientProvisioning,
  rotationDueAt,
  SERVICE_CLIENT_ROTATION_DAYS,
} from '../services/auth/service-client-provisioning';
import { bindCmServiceClientTenant } from '../services/identity/cm-service-clients';
import { bindCmAppDatabase, runCmIdentityWrite } from '../services/identity/cm-transaction';

const main = async (): Promise<void> => {
  const desired = buildServiceClientRegistration(process.env);
  const { clientId } = desired;
  const { plan, dueAt } = await runCmIdentityWrite(async (tx) => {
    const appDb = bindCmAppDatabase(tx);
    const [stored] = await appDb.select().from(serviceClients).where(eq(serviceClients.clientId, clientId)).limit(1);
    const [collision] = await appDb.select({ clientId: oauthClients.clientId }).from(oauthClients)
      .where(eq(oauthClients.clientId, clientId)).limit(1);
    const binding = await oauthTenantStoreV1(tx).findServiceClientBinding(clientId);
    const tenant = await tx.stores.tenants.findTenantBySlug(desired.tenantSlug);
    const plan = planServiceClientProvisioning(desired, {
      binding: binding ? { tenantId: binding.tenantId } : null,
      oauthClientCollision: Boolean(collision),
      stored: stored ?? null,
      tenant: tenant ? { status: tenant.status, tenantId: tenant.tenantId } : null,
    });
    const now = new Date();
    const policy = {
      allowedScopes: desired.allowedScopes,
      displayName: desired.displayName,
      dpopBoundAccessTokens: desired.dpopBoundAccessTokens,
      resourceIndicators: desired.resourceIndicators,
    };
    if (plan.action === 'create') {
      await appDb.insert(serviceClients).values({
        ...policy, clientId, clientSecretHash: desired.clientSecretHash, createdAt: now,
        exchangePolicy: null, id: `provisioned-${clientId}`, revokedAt: null,
      });
    } else if (plan.action === 'update') {
      await appDb.update(serviceClients).set({
        ...policy,
        ...(plan.rotateSecret ? { clientSecretHash: desired.clientSecretHash, secretRotatedAt: now } : {}),
      }).where(eq(serviceClients.clientId, clientId));
    }
    if (plan.bindTenant) await bindCmServiceClientTenant(tx, clientId, desired.tenantSlug);
    const rotatedAt = plan.rotateSecret ? now : stored?.secretRotatedAt ?? null;
    return { plan, dueAt: rotationDueAt(stored?.createdAt ?? now, rotatedAt) };
  });

  const outcome = plan.action === 'create' ? 'created'
    : plan.action === 'update' ? `updated (${plan.changes.join(', ')})` : 'unchanged (replay no-op)';
  console.log(`Service client ${clientId}: ${outcome}`);
  console.log('  grant: client_credentials (no exchange policy)');
  console.log(`  scopes: ${desired.allowedScopes.join(' ')}`);
  console.log(`  resource indicators: ${desired.resourceIndicators.join(', ')}`);
  console.log(`  tenant: ${desired.tenantSlug} (${plan.bindTenant ? 'bound now' : 'already bound'})`);
  console.log(`  DPoP-bound tokens: ${desired.dpopBoundAccessTokens ? 'required' : 'not required'}`);
  console.log('  secret: sha256 hash stored; plaintext neither stored nor printed');
  console.log(`  rotation due by: ${dueAt.toISOString().slice(0, 10)} (${SERVICE_CLIENT_ROTATION_DAYS}-day cycle)`);
};

// The CM write runs only when executed directly (Job or tsx); importing stays side-effect-free.
const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  try {
    await main();
  } catch (error) {
    // First line only: a wrapped driver error may append bound parameters (the secret hash).
    const failure = error instanceof Error ? (error.cause instanceof Error ? error.cause : error) : null;
    console.error('Failed to provision service client:', failure ? failure.message.split('\n')[0] : 'unknown error');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
