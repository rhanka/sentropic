import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { documentConnectorAccounts, type DocumentConnectorAccountRow } from '../db/schema';
import { logger } from '../logger';
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { settingsService } from './settings';
import {
  GOOGLE_DRIVE_PROVIDER,
  GoogleDriveTokenEndpointError,
  refreshGoogleDriveAccessToken,
  resolveGoogleDriveOAuthConfig,
  revokeGoogleOAuthToken,
  type GoogleDriveAccountIdentity,
  type GoogleDriveTokenResponse,
} from './google-drive-oauth';

export type GoogleDriveConnectionStatus = 'connected' | 'disconnected' | 'error';

export const CONNECTOR_ACCOUNT_LIMIT_REACHED = 'connector_account_limit_reached' as const;

export class ConnectorAccountLimitError extends Error {
  readonly code = CONNECTOR_ACCOUNT_LIMIT_REACHED;

  constructor() {
    super('Connector account limit reached for this provider.');
    this.name = 'ConnectorAccountLimitError';
  }
}

export type GoogleDriveConnectionPublic = {
  id: string | null;
  provider: typeof GOOGLE_DRIVE_PROVIDER;
  status: GoogleDriveConnectionStatus;
  connected: boolean;
  accountEmail: string | null;
  accountSubject: string | null;
  scopes: string[];
  tokenExpiresAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type GoogleDriveTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: string;
  scope: string | null;
  scopes: string[];
  obtainedAt: string;
  expiresAt: string | null;
};

const normalizeScopes = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};


const GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS = 60 * 1000;
const GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE =
  'Google Drive authorization expired or was revoked. Reconnect Google Drive.';
const GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED_MESSAGE = 'Google Drive OAuth is not configured.';

const isGoogleDriveTokenExpired = (expiresAt: string | null | undefined, nowMs = Date.now()): boolean => {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= nowMs + GOOGLE_DRIVE_TOKEN_REFRESH_SKEW_MS;
};

const markGoogleDriveConnectorTokenError = async (input: {
  accountId: string;
  message: string;
  clearTokenSecret: boolean;
}): Promise<void> => {
  await db
    .update(documentConnectorAccounts)
    .set({
      status: 'error',
      lastError: input.message,
      updatedAt: new Date(),
      ...(input.clearTokenSecret
        ? {
            tokenSecret: null,
            tokenExpiresAt: null,
          }
        : {}),
    })
    .where(eq(documentConnectorAccounts.id, input.accountId));
};

const refreshStoredGoogleDriveTokenSecret = async (input: {
  accountId: string;
  token: GoogleDriveTokenSecretPayload;
}): Promise<GoogleDriveTokenSecretPayload | null> => {
  if (!isGoogleDriveTokenExpired(input.token.expiresAt)) return input.token;
  if (!input.token.refreshToken) {
    await markGoogleDriveConnectorTokenError({
      accountId: input.accountId,
      message: GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE,
      clearTokenSecret: true,
    });
    return null;
  }

  const config = await resolveGoogleDriveOAuthConfig();
  if (!config) {
    await markGoogleDriveConnectorTokenError({
      accountId: input.accountId,
      message: GOOGLE_DRIVE_OAUTH_NOT_CONFIGURED_MESSAGE,
      clearTokenSecret: false,
    });
    return null;
  }

  try {
    const refreshed = await refreshGoogleDriveAccessToken({
      refreshToken: input.token.refreshToken,
      config,
    });
    const merged: GoogleDriveTokenSecretPayload = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? input.token.refreshToken,
      idToken: refreshed.idToken ?? input.token.idToken,
      tokenType: refreshed.tokenType,
      scope: refreshed.scope ?? input.token.scope,
      scopes: refreshed.scopes.length > 0 ? refreshed.scopes : input.token.scopes,
      obtainedAt: refreshed.obtainedAt,
      expiresAt: refreshed.expiresAt,
    };

    await db
      .update(documentConnectorAccounts)
      .set({
        status: 'connected',
        scopes: merged.scopes,
        tokenSecret: encryptSecret(JSON.stringify(merged)),
        tokenExpiresAt: merged.expiresAt ? new Date(merged.expiresAt) : null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(documentConnectorAccounts.id, input.accountId));

    return merged;
  } catch (error) {
    // Erase the stored refresh token ONLY when Google itself declares the grant dead
    // (`invalid_grant`: user revoked access, password change, token expired by policy). In that case
    // the secret is genuinely worthless and keeping it would only mislead.
    //
    // Every OTHER failure — network outage, Google 5xx, rate limit, a misconfigured client secret —
    // is TRANSIENT or OURS. Erasing on those turned a temporary hiccup into permanent credential
    // loss: the refresh token is not recoverable, so the user had to re-authorize even though their
    // grant was still perfectly valid. The account is still marked in error and surfaces the
    // reconnect message; we simply keep the secret so a later attempt can succeed.
    const grantIsDead = error instanceof GoogleDriveTokenEndpointError && error.isUnrecoverableGrant;
    await markGoogleDriveConnectorTokenError({
      accountId: input.accountId,
      message: error instanceof Error ? error.message : GOOGLE_DRIVE_RECONNECT_REQUIRED_MESSAGE,
      clearTokenSecret: grantIsDead,
    });
    return null;
  }
};

export const toPublicGoogleDriveConnection = (
  row: DocumentConnectorAccountRow | null | undefined,
): GoogleDriveConnectionPublic => {
  if (!row) {
    return {
      id: null,
      provider: GOOGLE_DRIVE_PROVIDER,
      status: 'disconnected',
      connected: false,
      accountEmail: null,
      accountSubject: null,
      scopes: [],
      tokenExpiresAt: null,
      connectedAt: null,
      disconnectedAt: null,
      lastError: null,
      updatedAt: null,
    };
  }

  const status = row.status === 'connected' || row.status === 'error' ? row.status : 'disconnected';
  return {
    id: row.id,
    provider: GOOGLE_DRIVE_PROVIDER,
    status,
    connected: status === 'connected',
    accountEmail: row.accountEmail ?? null,
    accountSubject: row.accountSubject ?? null,
    scopes: normalizeScopes(row.scopes),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    lastError: row.lastError ?? null,
    updatedAt: toIso(row.updatedAt),
  };
};

export const listConnectorAccounts = async (
  workspaceId: string,
  userId: string,
  provider: string,
): Promise<DocumentConnectorAccountRow[]> =>
  db
    .select()
    .from(documentConnectorAccounts)
    .where(
      and(
        eq(documentConnectorAccounts.userId, userId),
        eq(documentConnectorAccounts.workspaceId, workspaceId),
        eq(documentConnectorAccounts.provider, provider),
      ),
    )
    .orderBy(
      sql`${documentConnectorAccounts.connectedAt} DESC NULLS LAST`,
      desc(documentConnectorAccounts.updatedAt),
    );

export const getGoogleDriveConnectorAccount = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<DocumentConnectorAccountRow | null> => {
  const [row] = await listConnectorAccounts(
    input.workspaceId,
    input.userId,
    GOOGLE_DRIVE_PROVIDER,
  );
  return row ?? null;
};

export const getGoogleDriveConnection = async (
  input: {
    userId: string;
    workspaceId: string;
  },
  options: { validateToken?: boolean } = {},
): Promise<GoogleDriveConnectionPublic> => {
  let account = await getGoogleDriveConnectorAccount(input);
  if (options.validateToken && account && account.status !== 'disconnected') {
    await resolveGoogleDriveTokenSecret(input);
    account = await getGoogleDriveConnectorAccount(input);
  }
  return toPublicGoogleDriveConnection(account);
};

export const storeGoogleDriveTokenMaterial = async (input: {
  userId: string;
  workspaceId: string;
  token: GoogleDriveTokenResponse;
  identity: GoogleDriveAccountIdentity;
}): Promise<GoogleDriveConnectionPublic> => {
  const accounts = await listConnectorAccounts(
    input.workspaceId,
    input.userId,
    GOOGLE_DRIVE_PROVIDER,
  );
  const isExistingSubject = accounts.some(
    (account) => account.accountSubject === input.identity.accountSubject,
  );
  if (!isExistingSubject) {
    const maxPerProvider = await settingsService.getConnectorAccountsMaxPerProvider();
    const distinctAccountCount = accounts.filter((account) => account.accountSubject !== null).length;
    if (distinctAccountCount >= maxPerProvider) {
      throw new ConnectorAccountLimitError();
    }
  }

  const now = new Date();
  const tokenSecretPayload: GoogleDriveTokenSecretPayload = {
    accessToken: input.token.accessToken,
    refreshToken: input.token.refreshToken,
    idToken: input.token.idToken,
    tokenType: input.token.tokenType,
    scope: input.token.scope,
    scopes: input.token.scopes,
    obtainedAt: input.token.obtainedAt,
    expiresAt: input.token.expiresAt,
  };
  const values = {
    id: createId(),
    workspaceId: input.workspaceId,
    userId: input.userId,
    provider: GOOGLE_DRIVE_PROVIDER,
    status: 'connected',
    accountEmail: input.identity.accountEmail,
    accountSubject: input.identity.accountSubject,
    scopes: input.token.scopes,
    tokenSecret: encryptSecret(JSON.stringify(tokenSecretPayload)),
    tokenExpiresAt: input.token.expiresAt ? new Date(input.token.expiresAt) : null,
    connectedAt: now,
    disconnectedAt: null,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(documentConnectorAccounts)
    .values(values)
    .onConflictDoUpdate({
      target: [
        documentConnectorAccounts.workspaceId,
        documentConnectorAccounts.userId,
        documentConnectorAccounts.provider,
        documentConnectorAccounts.accountSubject,
      ],
      set: {
        status: 'connected',
        accountEmail: values.accountEmail,
        accountSubject: values.accountSubject,
        scopes: values.scopes,
        tokenSecret: values.tokenSecret,
        tokenExpiresAt: values.tokenExpiresAt,
        connectedAt: values.connectedAt,
        disconnectedAt: null,
        lastError: null,
        updatedAt: values.updatedAt,
      },
    });

  return getGoogleDriveConnection(input);
};

/**
 * Best-effort upstream revocation of a stored grant. Never throws: disconnect must complete.
 * Returns nothing — the outcome is logged, so an operator can tell a revoked grant from a forgotten
 * one when reconstructing what an incident actually contained.
 */
/**
 * Extract the token to revoke from a stored secret. Returns null when nothing usable is stored.
 *
 * Prefer the REFRESH token: revoking it kills the whole grant, whereas revoking an access token
 * kills one session. `||` (not `??`) because a stored empty string must fall through to the access
 * token rather than be treated as a usable token.
 *
 * Never throws: an undecryptable or malformed secret must not prevent the user from disconnecting.
 */
const readRevocableGoogleDriveToken = (tokenSecret: string | null): string | null => {
  if (!tokenSecret) return null;
  try {
    const decrypted = decryptSecretOrNull(tokenSecret);
    if (!decrypted) return null;
    const parsed = JSON.parse(decrypted) as Partial<GoogleDriveTokenSecretPayload> | null;
    const refresh = typeof parsed?.refreshToken === 'string' ? parsed.refreshToken : '';
    const access = typeof parsed?.accessToken === 'string' ? parsed.accessToken : '';
    return refresh || access || null;
  } catch {
    return null;
  }
};

/**
 * Tell Google to revoke a grant. Best-effort, and deliberately called AFTER the local row is
 * cleared — see the ordering note in `disconnectGoogleDriveConnectorAccount`.
 *
 * The outcome is LOGGED rather than assumed: "we called revoke" is not "the grant is revoked", and
 * during an incident an operator must be able to tell a revoked grant from a merely forgotten one.
 */
const revokeGoogleDriveGrantUpstream = async (accountId: string, token: string): Promise<void> => {
  const result = await revokeGoogleOAuthToken({ token });
  if (result.revoked) {
    logger.info({ accountId }, 'google-drive: grant revoked upstream at Google');
  } else {
    logger.warn(
      { accountId, status: result.status, error: result.error },
      'google-drive: upstream revocation FAILED — the grant may still be live at Google',
    );
  }
};


export const disconnectGoogleDriveConnectorAccount = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<GoogleDriveConnectionPublic> => {
  // EVERY account, not the first one.
  //
  // The uniqueness constraint is on (workspace, user, provider, accountSubject), so one user may
  // legitimately hold several connected Google accounts. `POST /disconnect` carries no account
  // identifier — it only knows the authenticated user — so its meaning to the user is "disconnect
  // Google Drive", not "disconnect whichever account happens to sort first". Acting on a single row
  // returned a success while leaving the other accounts' refresh tokens stored locally AND their
  // grants live at Google: the exact silent failure this revocation work exists to remove.
  const existing = await listConnectorAccounts(
    input.workspaceId,
    input.userId,
    GOOGLE_DRIVE_PROVIDER,
  );
  if (existing.length === 0) return toPublicGoogleDriveConnection(null);

  // ORDERING IS THE WHOLE DESIGN HERE.
  //
  // Nulling `tokenSecret` alone leaves the grant alive at Google: the user believes they revoked
  // access and they did not, and any copy of the token that leaked keeps working. So we must also
  // tell Google.
  //
  // But revoking BEFORE the local write puts an unbounded outbound HTTP call in front of the only
  // step that is guaranteed to succeed. If egress to Google is blackholed — dropped rather than
  // refused, which is exactly what a network incident looks like — the request hangs and the row is
  // never cleared. Disconnect would then fail precisely under the conditions that make people want
  // to disconnect.
  //
  // So: read the tokens into memory, clear the rows, THEN revoke upstream with the in-memory copies.
  // The local disconnect is unconditional and immediate; the remote calls can take as long as they
  // like without holding it hostage. That also removes the crash window in which a revoked grant
  // was still stored locally as "connected".
  const revocable = existing.map((row) => ({
    accountId: row.id,
    token: readRevocableGoogleDriveToken(row.tokenSecret),
  }));

  // One statement over the whole (workspace, user, provider) set rather than a loop over ids: a
  // partial clear is worse than none, because it reports success while leaving live tokens behind.
  await db
    .update(documentConnectorAccounts)
    .set({
      status: 'disconnected',
      tokenSecret: null,
      tokenExpiresAt: null,
      disconnectedAt: new Date(),
      lastError: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(documentConnectorAccounts.userId, input.userId),
        eq(documentConnectorAccounts.workspaceId, input.workspaceId),
        eq(documentConnectorAccounts.provider, GOOGLE_DRIVE_PROVIDER),
      ),
    );

  // Concurrently, and never sequentially: each revocation is already bounded by its own timeout, so
  // a serial loop would make the worst case scale with the number of connected accounts for no gain.
  // `revokeGoogleDriveGrantUpstream` is best-effort and never throws, so nothing here can fail the
  // disconnect that has already been committed above.
  await Promise.all(
    revocable.map(async ({ accountId, token }) => {
      if (token) {
        await revokeGoogleDriveGrantUpstream(accountId, token);
        return;
      }
      logger.warn(
        { accountId },
        'google-drive: disconnected locally but found no token to revoke upstream — the grant may still be live at Google',
      );
    }),
  );

  return getGoogleDriveConnection(input);
};

export const markGoogleDriveConnectorError = async (input: {
  userId: string;
  workspaceId: string;
  message: string;
}): Promise<GoogleDriveConnectionPublic> => {
  const existing = await getGoogleDriveConnectorAccount(input);
  const now = new Date();
  if (!existing) {
    await db.insert(documentConnectorAccounts).values({
      id: createId(),
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: GOOGLE_DRIVE_PROVIDER,
      status: 'error',
      accountEmail: null,
      accountSubject: null,
      scopes: [],
      tokenSecret: null,
      tokenExpiresAt: null,
      connectedAt: null,
      disconnectedAt: null,
      lastError: input.message,
      createdAt: now,
      updatedAt: now,
    });
    return getGoogleDriveConnection(input);
  }

  await db
    .update(documentConnectorAccounts)
    .set({
      status: 'error',
      tokenSecret: null,
      tokenExpiresAt: null,
      lastError: input.message,
      updatedAt: now,
    })
    .where(eq(documentConnectorAccounts.id, existing.id));

  return getGoogleDriveConnection(input);
};

export const resolveGoogleDriveTokenSecret = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<GoogleDriveTokenSecretPayload | null> => {
  const account = await getGoogleDriveConnectorAccount(input);
  if (!account || (account.status !== 'connected' && account.status !== 'error')) return null;
  const decrypted = decryptSecretOrNull(account.tokenSecret);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<GoogleDriveTokenSecretPayload> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.accessToken !== 'string') {
      return null;
    }
    const secret = {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'Bearer',
      scope: typeof parsed.scope === 'string' ? parsed.scope : null,
      scopes: normalizeScopes(parsed.scopes),
      obtainedAt: typeof parsed.obtainedAt === 'string' ? parsed.obtainedAt : '',
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
    return await refreshStoredGoogleDriveTokenSecret({
      accountId: account.id,
      token: secret,
    });
  } catch {
    return null;
  }
};

export const resolveGoogleDriveTokenSecretByAccountId = async (input: {
  connectorAccountId: string;
}): Promise<GoogleDriveTokenSecretPayload | null> => {
  const id = (input.connectorAccountId || '').trim();
  if (!id) return null;

  const [row] = await db
    .select()
    .from(documentConnectorAccounts)
    .where(eq(documentConnectorAccounts.id, id))
    .limit(1);
  if (!row || (row.status !== 'connected' && row.status !== 'error')) return null;

  const decrypted = decryptSecretOrNull(row.tokenSecret);
  if (!decrypted) return null;

  try {
    const parsed = JSON.parse(decrypted) as Partial<GoogleDriveTokenSecretPayload> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.accessToken !== 'string') {
      return null;
    }
    const secret = {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'Bearer',
      scope: typeof parsed.scope === 'string' ? parsed.scope : null,
      scopes: normalizeScopes(parsed.scopes),
      obtainedAt: typeof parsed.obtainedAt === 'string' ? parsed.obtainedAt : '',
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
    return await refreshStoredGoogleDriveTokenSecret({
      accountId: row.id,
      token: secret,
    });
  } catch {
    return null;
  }
};
