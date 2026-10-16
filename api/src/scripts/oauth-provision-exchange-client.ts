#!/usr/bin/env tsx
//
// 2-IdP — PROD-SAFE workload creation for `immo-mcp-workload`.
//
// This is NOT the dev seed (`oauth-seed-clients.ts`), which bakes well-known
// dev-only secrets and MUST NEVER run in prod. This script creates ONE
// `service_clients` row for the named exchange-only workload, fully env-driven,
// idempotent on replay: a second run with the same desired policy is a no-op.
//
// Required env:
//   OAUTH_WORKLOAD_CLIENT_SECRET  the STRONG, generated workload secret
//                                 (plaintext); only its sha256 hash is stored.
//                                 NEVER committed, never printed.
// Optional env (defaults target the Immo workload):
//   OAUTH_WORKLOAD_CLIENT_ID      default "immo-mcp-workload" (the ONLY
//                                 creatable id; any other value refuses)
//   OAUTH_WORKLOAD_SUBJECT_AUD    default "https://immo.sent-tech.ca/mcp"
//   OAUTH_WORKLOAD_TARGET_AUD     default "https://immo.sent-tech.ca"
//
// Desired policy (initial downstream, search-only):
//   enabled, subject client immo-mcp, exact audiences above, actorSub =
//   client id, allowedScopes [immo:search], maxTtlSeconds 300,
//   allowClientCredentials false. The public `immo-mcp` row is never touched.
//
// Conflict rule: an existing active row whose exchange policy differs from the
// desired policy REFUSES instead of overwriting (converge policy through the
// reviewed sync pass). A revoked row refuses (use rotation/revive explicitly).

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, pool } from '../db/client';
import { serviceClients } from '../db/schema';

const WORKLOAD_CLIENT_ID = 'immo-mcp-workload';
const DEFAULT_SUBJECT_AUD = 'https://immo.sent-tech.ca/mcp';
const DEFAULT_TARGET_AUD = 'https://immo.sent-tech.ca';

const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

const desiredPolicy = (clientId: string, subjectAud: string, targetAud: string) => ({
  actorSub: clientId,
  allowClientCredentials: false,
  allowedScopes: ['immo:search'],
  allowedSubjectAudiences: [subjectAud],
  allowedSubjectClients: ['immo-mcp'],
  allowedTargetAudiences: [targetAud],
  enabled: true,
  environment: null,
  maxTtlSeconds: 300,
});

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key])])
    );
  }
  return value;
};

// Order-insensitive deep comparison: jsonb key order depends on the writer
// (seed vs sync build different orders for the same policy).
const isSamePolicy = (a: unknown, b: unknown): boolean =>
  JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));

try {
  // Empty string counts as unset: the Make target always passes the vars through
  // (possibly empty), and only an explicit non-empty value overrides the default.
  const clientId = (process.env.OAUTH_WORKLOAD_CLIENT_ID || WORKLOAD_CLIENT_ID).trim();
  if (clientId !== WORKLOAD_CLIENT_ID) {
    console.error(`Refusing: only '${WORKLOAD_CLIENT_ID}' may be created by this script.`);
    process.exitCode = 1;
  } else {
    const secret = process.env.OAUTH_WORKLOAD_CLIENT_SECRET ?? '';
    if (!secret || secret.length < 32) {
      console.error('Missing or weak OAUTH_WORKLOAD_CLIENT_SECRET (≥32 chars required).');
      process.exitCode = 1;
    } else {
      const subjectAud = (process.env.OAUTH_WORKLOAD_SUBJECT_AUD || DEFAULT_SUBJECT_AUD).trim();
      const targetAud = (process.env.OAUTH_WORKLOAD_TARGET_AUD || DEFAULT_TARGET_AUD).trim();
      const policy = desiredPolicy(clientId, subjectAud, targetAud);

      const [existing] = await db
        .select()
        .from(serviceClients)
        .where(eq(serviceClients.clientId, clientId))
        .limit(1);

      if (existing && existing.revokedAt) {
        console.error(`Refusing: ${clientId} is revoked; revive/rotate explicitly.`);
        process.exitCode = 1;
      } else if (existing && !isSamePolicy(existing.exchangePolicy, policy)) {
        console.error(`Refusing: ${clientId} exists with a conflicting exchange policy; converge via the reviewed sync pass.`);
        process.exitCode = 1;
      } else if (existing) {
        console.log(`Workload client ${clientId} already provisioned (replay no-op).`);
      } else {
        const now = new Date();
        await db.insert(serviceClients).values({
          allowedScopes: ['immo:search'],
          clientId,
          clientSecretHash: hashSecret(secret),
          createdAt: now,
          displayName: 'Immo MCP workload (token exchange only)',
          dpopBoundAccessTokens: false,
          exchangePolicy: policy,
          id: `provisioned-${clientId}`,
          resourceIndicators: [targetAud],
          revokedAt: null,
          tenantId: 'sentropic',
        });
        console.log(`Workload client ${clientId} created with search-only exchange policy.`);
      }
    }
  }
} catch (error) {
  console.error('Failed to provision workload client:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
