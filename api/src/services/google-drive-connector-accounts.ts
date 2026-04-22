import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { documentConnectorAccounts, type DocumentConnectorAccountRow } from '../db/schema';
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import {
  GOOGLE_DRIVE_PROVIDER,
  type GoogleDriveAccountIdentity,
  type GoogleDriveTokenResponse,
} from './google-drive-oauth';

export type GoogleDriveConnectionStatus = 'connected' | 'disconnected' | 'error';

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

export const getGoogleDriveConnectorAccount = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<DocumentConnectorAccountRow | null> => {
  const [row] = await db
    .select()
    .from(documentConnectorAccounts)
    .where(
      and(
        eq(documentConnectorAccounts.userId, input.userId),
        eq(documentConnectorAccounts.workspaceId, input.workspaceId),
        eq(documentConnectorAccounts.provider, GOOGLE_DRIVE_PROVIDER),
      ),
    )
    .limit(1);
  return row ?? null;
};

export const getGoogleDriveConnection = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<GoogleDriveConnectionPublic> =>
  toPublicGoogleDriveConnection(await getGoogleDriveConnectorAccount(input));

export const storeGoogleDriveTokenMaterial = async (input: {
  userId: string;
  workspaceId: string;
  token: GoogleDriveTokenResponse;
  identity: GoogleDriveAccountIdentity;
}): Promise<GoogleDriveConnectionPublic> => {
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

export const disconnectGoogleDriveConnectorAccount = async (input: {
  userId: string;
  workspaceId: string;
}): Promise<GoogleDriveConnectionPublic> => {
  const existing = await getGoogleDriveConnectorAccount(input);
  if (!existing) return toPublicGoogleDriveConnection(null);

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
    .where(eq(documentConnectorAccounts.id, existing.id));

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
  if (!account || account.status !== 'connected') return null;
  const decrypted = decryptSecretOrNull(account.tokenSecret);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<GoogleDriveTokenSecretPayload> | null;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.accessToken !== 'string') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
      idToken: typeof parsed.idToken === 'string' ? parsed.idToken : null,
      tokenType: typeof parsed.tokenType === 'string' ? parsed.tokenType : 'Bearer',
      scope: typeof parsed.scope === 'string' ? parsed.scope : null,
      scopes: normalizeScopes(parsed.scopes),
      obtainedAt: typeof parsed.obtainedAt === 'string' ? parsed.obtainedAt : '',
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : null,
    };
  } catch {
    return null;
  }
};
