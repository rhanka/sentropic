// Revocation-aware Cowork admission (BR-41d, INV-01/02/05).
//
// Runs after mcp.verify: binds the verified token to the single owner, the
// static client and the tier resource with fresh store reads on every call.
// No positive cache. Any store failure denies with 503 (never 401, which
// would push Claude into a reconnect loop).

import { eq } from 'drizzle-orm';

import type { McpAuthContext } from '@sentropic/mcp-auth';

import { db } from '../../db/client';
import { users } from '../../db/schema';
import { createOauthStateStoreAdapter } from '../auth/oauth-state-adapter';
import {
  COWORK_CONTROL_SCOPE,
  type CoworkRemoteConfig,
  type CoworkTier,
} from './config';

export interface CoworkAdmission {
  tier: CoworkTier;
  ownerSub: string;
  clientId: string;
  jti: string;
  exp: number;
}

export type CoworkAdmissionResult =
  | { ok: true; admission: CoworkAdmission }
  | {
      ok: false;
      status: 401 | 403 | 503;
      code: string;
      message: string;
      challengeScopes?: string[];
    };

const STORE_UNAVAILABLE = 'Authorization store unavailable.';

export const admitCoworkRequest = async (
  config: CoworkRemoteConfig,
  verified: McpAuthContext,
): Promise<CoworkAdmissionResult> => {
  if (!verified.scopes.includes(COWORK_CONTROL_SCOPE)) {
    return {
      challengeScopes: [COWORK_CONTROL_SCOPE],
      code: 'insufficient_scope',
      message: 'Missing required scope: cowork:control.',
      ok: false,
      status: 403,
    };
  }
  const jti = typeof verified.claims.jti === 'string' ? verified.claims.jti : null;
  const exp = typeof verified.claims.exp === 'number' ? verified.claims.exp : null;
  if (!jti || !exp) {
    return { code: 'invalid_token', message: 'Token misses jti or exp.', ok: false, status: 401 };
  }
  if (verified.sub !== config.ownerSub) {
    return { code: 'invalid_token', message: 'Unknown subject.', ok: false, status: 401 };
  }
  if (verified.clientId !== config.clientId) {
    return { code: 'invalid_token', message: 'Unknown client.', ok: false, status: 401 };
  }
  const store = createOauthStateStoreAdapter();
  let meta;
  try {
    meta = await store.findTokenMeta(jti);
  } catch {
    return { code: 'admission_unavailable', message: STORE_UNAVAILABLE, ok: false, status: 503 };
  }
  if (!meta || meta.audience !== config.resource || meta.clientId !== config.clientId) {
    return { code: 'invalid_token', message: 'Token is unknown, expired or misbound.', ok: false, status: 401 };
  }
  try {
    if (await store.isTokenRevoked(jti)) {
      return { code: 'invalid_token', message: 'Token is revoked.', ok: false, status: 401 };
    }
  } catch {
    return { code: 'admission_unavailable', message: STORE_UNAVAILABLE, ok: false, status: 503 };
  }
  let client;
  try {
    client = await store.findClient(config.clientId);
  } catch {
    return { code: 'admission_unavailable', message: STORE_UNAVAILABLE, ok: false, status: 503 };
  }
  if (
    !client ||
    !client.allowedScopes.includes(COWORK_CONTROL_SCOPE) ||
    !client.resourceIndicators.includes(config.resource)
  ) {
    return { code: 'invalid_token', message: 'Client is not admitted for cowork:control.', ok: false, status: 401 };
  }
  let owner;
  try {
    [owner] = await db.select().from(users).where(eq(users.id, config.ownerSub)).limit(1);
  } catch {
    return { code: 'admission_unavailable', message: STORE_UNAVAILABLE, ok: false, status: 503 };
  }
  if (!owner || owner.accountStatus !== 'active' || owner.disabledAt !== null) {
    return { code: 'invalid_token', message: 'Owner is not active.', ok: false, status: 401 };
  }
  return { admission: { clientId: config.clientId, exp, jti, ownerSub: config.ownerSub, tier: config.tier }, ok: true };
};
