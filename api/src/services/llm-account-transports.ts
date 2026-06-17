import { createHmac } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { pool, db } from '../db/client';
import { env } from '../config/env';
import { createId } from '../utils/id';
import { decryptSecretOrNull, encryptSecret } from './secret-crypto';
import { refreshCodexAccessToken } from './codex-provider-auth';

export type LlmAccountTransportStatus =
  | 'active'
  | 'cooldown'
  | 'reauth_required'
  | 'disabled'
  | 'disconnected';

export type LlmAccountTransportPublic = {
  id: string;
  targetProviderId: string;
  transportProviderId: string;
  externalAccountId: string | null;
  accountLabel: string | null;
  status: LlmAccountTransportStatus;
  connectedAt: string | null;
  disconnectedAt: string | null;
  tokenExpiresAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type CodexAccountTransportAcquisition = {
  accessToken: string;
  accountId: string | null;
  accountLabel: string | null;
  stableSessionId: string;
  accountTransportAccountId: string;
  leaseId: string;
  reservationId: string;
  recordOutcome(input: LlmAccountTransportOutcomeInput): Promise<void>;
};

export type LlmAccountTransportOutcomeInput = {
  status: 'success' | 'failed' | 'rate_limited' | 'auth_failed';
  providerStatusCode?: number | null;
  retryAfterMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

export type CodexTokenSecretPayload = {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  tokenType: 'bearer';
  obtainedAt: string;
  expiresAt: string | null;
  source: 'codex-device' | 'legacy-codex-setting' | 'codex-refresh';
};

type AccountSelectionRow = {
  account_id: string;
  external_account_id: string | null;
  account_label: string | null;
  token_secret: string | null;
  token_expires_at: Date | string | null;
  model_allowlist: unknown;
};

type LeaseSelectionRow = AccountSelectionRow & {
  lease_id: string;
  stable_session_id: string;
  account_status: string;
  cooldown_until: Date | string | null;
};

type AcquisitionRow = AccountSelectionRow & {
  lease_id: string;
  stable_session_id: string;
  reservation_id: string;
};

const CODEX_TARGET_PROVIDER_ID = 'openai';
const CODEX_TRANSPORT_PROVIDER_ID = 'codex';
const RESERVATION_TTL_MS = 5 * 60 * 1000;
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

const refreshes = new Map<string, Promise<CodexTokenSecretPayload | null>>();

const normalizeText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeOptionalText = (value: unknown): string | null => {
  const normalized = normalizeText(value);
  return normalized.length > 0 ? normalized : null;
};

const toIso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const decodeJwtPayload = (jwt: string | null | undefined): Record<string, unknown> | null => {
  if (!jwt) return null;
  const [, payload] = jwt.split('.');
  if (!payload) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const readJwtStringClaim = (claims: Record<string, unknown> | null, key: string): string | null => {
  const value = claims?.[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
};

export const inferCodexAccountIdFromToken = (
  accessToken: string,
  idToken?: string | null,
): string | null => {
  const accessClaims = decodeJwtPayload(accessToken);
  const idClaims = idToken ? decodeJwtPayload(idToken) : null;
  const authClaim = (accessClaims?.['https://api.openai.com/auth'] ??
    idClaims?.['https://api.openai.com/auth']) as Record<string, unknown> | null | undefined;
  const orgs = (accessClaims?.organizations ?? idClaims?.organizations) as unknown;
  const firstOrg = Array.isArray(orgs) ? (orgs[0] as Record<string, unknown> | undefined) : undefined;
  return (
    readJwtStringClaim(accessClaims, 'chatgpt_account_id') ||
    readJwtStringClaim(idClaims, 'chatgpt_account_id') ||
    readJwtStringClaim(accessClaims, 'https://api.openai.com/auth.chatgpt_account_id') ||
    readJwtStringClaim(idClaims, 'https://api.openai.com/auth.chatgpt_account_id') ||
    (authClaim && typeof authClaim.chatgpt_account_id === 'string' ? authClaim.chatgpt_account_id.trim() : null) ||
    (firstOrg && typeof firstOrg.id === 'string' ? firstOrg.id.trim() : null)
  );
};

export const inferTokenExpiresAt = (
  accessToken: string | null | undefined,
  idToken?: string | null,
): string | null => {
  const accessExp = decodeJwtPayload(accessToken)?.exp;
  const idExp = decodeJwtPayload(idToken)?.exp;
  const exp =
    typeof accessExp === 'number'
      ? accessExp
      : typeof idExp === 'number'
        ? idExp
        : null;
  return exp && exp > 0 ? new Date(exp * 1000).toISOString() : null;
};

const parseTokenSecret = (value: string | null | undefined): CodexTokenSecretPayload | null => {
  const decrypted = decryptSecretOrNull(value);
  if (!decrypted) return null;
  try {
    const parsed = JSON.parse(decrypted) as Partial<CodexTokenSecretPayload> | null;
    const accessToken = normalizeOptionalText(parsed?.accessToken);
    if (!parsed || !accessToken) return null;
    return {
      accessToken,
      refreshToken: normalizeOptionalText(parsed.refreshToken),
      idToken: normalizeOptionalText(parsed.idToken),
      tokenType: 'bearer',
      obtainedAt: normalizeOptionalText(parsed.obtainedAt) ?? new Date().toISOString(),
      expiresAt: normalizeOptionalText(parsed.expiresAt),
      source:
        parsed.source === 'legacy-codex-setting' || parsed.source === 'codex-refresh'
          ? parsed.source
          : 'codex-device',
    };
  } catch {
    return null;
  }
};

const isTokenExpiring = (expiresAt: string | null | undefined): boolean => {
  if (!expiresAt) return false;
  const parsed = new Date(expiresAt);
  if (Number.isNaN(parsed.getTime())) return false;
  return parsed.getTime() <= Date.now() + TOKEN_REFRESH_SKEW_MS;
};

const computeStableSessionId = (input: {
  workspaceId: string | null;
  userId: string | null;
  affinityKey: string;
  targetProviderId: string;
  transportProviderId: string;
  modelId: string;
  leaseId: string;
}): string => {
  const secret = env.JWT_SECRET || 'dev-secret-key-change-in-production-please';
  const digest = createHmac('sha256', secret)
    .update([
      input.workspaceId ?? '',
      input.userId ?? '',
      input.affinityKey,
      input.targetProviderId,
      input.transportProviderId,
      input.modelId,
      input.leaseId,
    ].join('\u001f'))
    .digest('base64url')
    .slice(0, 32);
  return `codex_${digest}`;
};

const buildTokenPayload = (input: {
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  expiresAt?: string | null;
  source: CodexTokenSecretPayload['source'];
}): CodexTokenSecretPayload => ({
  accessToken: input.accessToken,
  refreshToken: input.refreshToken ?? null,
  idToken: input.idToken ?? null,
  tokenType: 'bearer',
  obtainedAt: new Date().toISOString(),
  expiresAt: input.expiresAt ?? inferTokenExpiresAt(input.accessToken, input.idToken),
  source: input.source,
});

export const storeCodexAccountTransport = async (input: {
  ownerUserId: string;
  accountLabel?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  idToken?: string | null;
  source?: CodexTokenSecretPayload['source'];
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  const accessToken = normalizeOptionalText(input.accessToken);
  if (!ownerUserId || !accessToken) return null;

  const token = buildTokenPayload({
    accessToken,
    refreshToken: normalizeOptionalText(input.refreshToken),
    idToken: normalizeOptionalText(input.idToken),
    source: input.source ?? 'codex-device',
  });
  const externalAccountId = inferCodexAccountIdFromToken(token.accessToken, token.idToken);
  const now = new Date();
  const accountId = createId();
  const tokenSecret = encryptSecret(JSON.stringify(token));
  const accountLabel = normalizeOptionalText(input.accountLabel);

  await db.run(sql`
    INSERT INTO llm_provider_accounts (
      id,
      owner_user_id,
      scope,
      target_provider_id,
      transport_provider_id,
      external_account_id,
      account_label,
      status,
      token_secret,
      token_expires_at,
      connected_at,
      disconnected_at,
      last_error,
      metadata,
      created_at,
      updated_at
    )
    VALUES (
      ${accountId},
      ${ownerUserId},
      'user',
      ${CODEX_TARGET_PROVIDER_ID},
      ${CODEX_TRANSPORT_PROVIDER_ID},
      ${externalAccountId},
      ${accountLabel},
      'active',
      ${tokenSecret},
      ${token.expiresAt ? new Date(token.expiresAt) : null},
      ${now},
      NULL,
      NULL,
      ${JSON.stringify({ source: token.source })}::jsonb,
      ${now},
      ${now}
    )
    ON CONFLICT (
      owner_user_id,
      target_provider_id,
      transport_provider_id,
      external_account_id
    )
    WHERE external_account_id IS NOT NULL
    DO UPDATE SET
      account_label = COALESCE(EXCLUDED.account_label, llm_provider_accounts.account_label),
      status = 'active',
      token_secret = EXCLUDED.token_secret,
      token_expires_at = EXCLUDED.token_expires_at,
      connected_at = EXCLUDED.connected_at,
      disconnected_at = NULL,
      last_error = NULL,
      metadata = EXCLUDED.metadata,
      updated_at = EXCLUDED.updated_at
  `);

  return getPrimaryCodexAccountTransport({ ownerUserId });
};

export const getPrimaryCodexAccountTransport = async (input: {
  ownerUserId: string;
}): Promise<LlmAccountTransportPublic | null> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return null;
  const rows = await db.all(sql`
    SELECT
      id,
      target_provider_id as "targetProviderId",
      transport_provider_id as "transportProviderId",
      external_account_id as "externalAccountId",
      account_label as "accountLabel",
      status,
      connected_at as "connectedAt",
      disconnected_at as "disconnectedAt",
      token_expires_at as "tokenExpiresAt",
      last_error as "lastError",
      updated_at as "updatedAt"
    FROM llm_provider_accounts
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
      AND status <> 'disconnected'
    ORDER BY
      CASE status
        WHEN 'active' THEN 0
        WHEN 'cooldown' THEN 1
        WHEN 'reauth_required' THEN 2
        ELSE 3
      END,
      connected_at DESC NULLS LAST,
      updated_at DESC NULLS LAST
    LIMIT 1
  `) as Array<{
    id: string;
    targetProviderId: string;
    transportProviderId: string;
    externalAccountId: string | null;
    accountLabel: string | null;
    status: LlmAccountTransportStatus;
    connectedAt: Date | string | null;
    disconnectedAt: Date | string | null;
    tokenExpiresAt: Date | string | null;
    lastError: string | null;
    updatedAt: Date | string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetProviderId: row.targetProviderId,
    transportProviderId: row.transportProviderId,
    externalAccountId: row.externalAccountId,
    accountLabel: row.accountLabel,
    status: row.status,
    connectedAt: toIso(row.connectedAt),
    disconnectedAt: toIso(row.disconnectedAt),
    tokenExpiresAt: toIso(row.tokenExpiresAt),
    lastError: row.lastError,
    updatedAt: toIso(row.updatedAt),
  };
};

export const disconnectCodexAccountTransports = async (input: {
  ownerUserId: string;
}): Promise<void> => {
  const ownerUserId = normalizeOptionalText(input.ownerUserId);
  if (!ownerUserId) return;
  const now = new Date();
  await db.run(sql`
    UPDATE llm_provider_accounts
    SET
      status = 'disconnected',
      token_secret = NULL,
      token_expires_at = NULL,
      disconnected_at = ${now},
      last_error = NULL,
      updated_at = ${now}
    WHERE owner_user_id = ${ownerUserId}
      AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
      AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
  `);
  await db.run(sql`
    UPDATE llm_account_leases
    SET status = 'invalidated', released_at = ${now}, updated_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE account_id IN (
      SELECT id FROM llm_provider_accounts
      WHERE owner_user_id = ${ownerUserId}
        AND target_provider_id = ${CODEX_TARGET_PROVIDER_ID}
        AND transport_provider_id = ${CODEX_TRANSPORT_PROVIDER_ID}
    )
      AND status = 'active'
  `);
};

const supportsModel = (modelAllowlist: unknown, modelId: string): boolean => {
  if (!Array.isArray(modelAllowlist) || modelAllowlist.length === 0) return true;
  return modelAllowlist.some((entry) => typeof entry === 'string' && entry === modelId);
};

const isLeasedAccountUsable = (row: LeaseSelectionRow, modelId: string, now: Date): boolean => {
  if (row.account_status !== 'active') return false;
  if (row.cooldown_until && new Date(row.cooldown_until).getTime() > now.getTime()) return false;
  return supportsModel(row.model_allowlist, modelId);
};

const refreshCodexTokenIfNeeded = async (input: {
  accountId: string;
  externalAccountId: string | null;
  token: CodexTokenSecretPayload;
}): Promise<CodexTokenSecretPayload | null> => {
  if (!isTokenExpiring(input.token.expiresAt)) return input.token;
  if (!input.token.refreshToken) {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          token_secret = NULL,
          token_expires_at = NULL,
          last_error = 'Codex token expired and no refresh token is available.',
          updated_at = ${new Date()}
      WHERE id = ${input.accountId}
    `);
    return null;
  }

  const existing = refreshes.get(input.accountId);
  if (existing) return existing;

  const refreshPromise = (async () => {
    try {
      const refreshed = await refreshCodexAccessToken({ refreshToken: input.token.refreshToken! });
      const next = buildTokenPayload({
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? input.token.refreshToken,
        idToken: refreshed.idToken ?? input.token.idToken,
        expiresAt: refreshed.expiresAt ?? inferTokenExpiresAt(refreshed.accessToken, refreshed.idToken),
        source: 'codex-refresh',
      });
      const nextExternalAccountId =
        inferCodexAccountIdFromToken(next.accessToken, next.idToken) ?? input.externalAccountId;
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET token_secret = ${encryptSecret(JSON.stringify(next))},
            token_expires_at = ${next.expiresAt ? new Date(next.expiresAt) : null},
            external_account_id = COALESCE(${nextExternalAccountId}, external_account_id),
            status = 'active',
            last_error = NULL,
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return next;
    } catch (error) {
      await db.run(sql`
        UPDATE llm_provider_accounts
        SET status = 'reauth_required',
            last_error = ${error instanceof Error ? error.message : 'Codex token refresh failed.'},
            updated_at = ${new Date()}
        WHERE id = ${input.accountId}
      `);
      return null;
    } finally {
      refreshes.delete(input.accountId);
    }
  })();

  refreshes.set(input.accountId, refreshPromise);
  return refreshPromise;
};

export const acquireOpenAICodexAccountTransport = async (input: {
  userId: string;
  workspaceId?: string | null;
  modelId: string;
  affinityKey?: string | null;
  requestId?: string | null;
}): Promise<CodexAccountTransportAcquisition | null> => {
  const userId = normalizeOptionalText(input.userId);
  if (!userId) return null;

  const workspaceId = normalizeOptionalText(input.workspaceId);
  const modelId = normalizeOptionalText(input.modelId) ?? 'gpt-5.5';
  const affinityKey = normalizeOptionalText(input.affinityKey) ?? `user:${userId}`;
  const requestId = normalizeOptionalText(input.requestId) ?? createId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESERVATION_TTL_MS);
  const client = await pool.connect();

  let acquired: AcquisitionRow | null = null;
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE llm_account_reservations
       SET status = 'expired'
       WHERE status = 'active' AND expires_at <= $1`,
      [now],
    );
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      [
        workspaceId ?? '',
        userId,
        affinityKey,
        CODEX_TARGET_PROVIDER_ID,
        CODEX_TRANSPORT_PROVIDER_ID,
        modelId,
      ].join('\u001f'),
    ]);

    const leaseResult = await client.query<LeaseSelectionRow>(
      `SELECT
         l.id as lease_id,
         l.stable_session_id,
         a.id as account_id,
         a.external_account_id,
         a.account_label,
         a.token_secret,
         a.token_expires_at,
         a.model_allowlist,
         a.status as account_status,
         a.cooldown_until
       FROM llm_account_leases l
       JOIN llm_provider_accounts a ON a.id = l.account_id
       WHERE l.status = 'active'
         AND coalesce(l.workspace_id, '') = coalesce($1::text, '')
         AND coalesce(l.user_id, '') = coalesce($2::text, '')
         AND l.affinity_key = $3
         AND l.target_provider_id = $4
         AND l.transport_provider_id = $5
         AND l.model_id = $6
       FOR UPDATE OF l, a`,
      [workspaceId, userId, affinityKey, CODEX_TARGET_PROVIDER_ID, CODEX_TRANSPORT_PROVIDER_ID, modelId],
    );
    const leased = leaseResult.rows[0];
    if (leased) {
      if (!isLeasedAccountUsable(leased, modelId, now)) {
        await client.query('COMMIT');
        return null;
      }
      const reservationId = createId();
      await client.query(
        `INSERT INTO llm_account_reservations (
           id, account_id, lease_id, request_id, status, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [reservationId, leased.account_id, leased.lease_id, requestId, expiresAt, now],
      );
      acquired = {
        ...leased,
        reservation_id: reservationId,
      };
      await client.query('COMMIT');
    } else {
      const accountResult = await client.query<AccountSelectionRow>(
        `SELECT
           a.id as account_id,
           a.external_account_id,
           a.account_label,
           a.token_secret,
           a.token_expires_at,
           a.model_allowlist
         FROM llm_provider_accounts a
         LEFT JOIN (
           SELECT account_id, count(*)::integer as active_reservations
           FROM llm_account_reservations
           WHERE status = 'active' AND expires_at > $1
           GROUP BY account_id
         ) r ON r.account_id = a.id
         LEFT JOIN (
           SELECT account_id, count(*)::integer as active_leases
           FROM llm_account_leases
           WHERE status = 'active'
           GROUP BY account_id
         ) l ON l.account_id = a.id
         WHERE a.owner_user_id = $2
           AND a.scope = 'user'
           AND a.target_provider_id = $3
           AND a.transport_provider_id = $4
           AND a.status = 'active'
           AND (a.cooldown_until IS NULL OR a.cooldown_until <= $1)
           AND (jsonb_array_length(a.model_allowlist) = 0 OR a.model_allowlist ? $5)
         ORDER BY
           a.priority DESC,
           ((coalesce(r.active_reservations, 0) + coalesce(l.active_leases, 0))::float / greatest(a.weight, 1)) ASC,
           a.connected_at ASC NULLS LAST,
           a.created_at ASC
         LIMIT 1
         FOR UPDATE OF a SKIP LOCKED`,
        [now, userId, CODEX_TARGET_PROVIDER_ID, CODEX_TRANSPORT_PROVIDER_ID, modelId],
      );
      const account = accountResult.rows[0];
      if (!account) {
        await client.query('COMMIT');
        return null;
      }

      const leaseId = createId();
      const stableSessionId = computeStableSessionId({
        workspaceId,
        userId,
        affinityKey,
        targetProviderId: CODEX_TARGET_PROVIDER_ID,
        transportProviderId: CODEX_TRANSPORT_PROVIDER_ID,
        modelId,
        leaseId,
      });
      const reservationId = createId();
      await client.query(
        `INSERT INTO llm_account_leases (
           id,
           workspace_id,
           user_id,
           affinity_key,
           target_provider_id,
           transport_provider_id,
           model_id,
           account_id,
           stable_session_id,
           status,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', $10, $10)`,
        [
          leaseId,
          workspaceId,
          userId,
          affinityKey,
          CODEX_TARGET_PROVIDER_ID,
          CODEX_TRANSPORT_PROVIDER_ID,
          modelId,
          account.account_id,
          stableSessionId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO llm_account_reservations (
           id, account_id, lease_id, request_id, status, expires_at, created_at
         )
         VALUES ($1, $2, $3, $4, 'active', $5, $6)`,
        [reservationId, account.account_id, leaseId, requestId, expiresAt, now],
      );
      acquired = {
        ...account,
        lease_id: leaseId,
        stable_session_id: stableSessionId,
        reservation_id: reservationId,
      };
      await client.query('COMMIT');
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (!acquired) return null;
  const token = parseTokenSecret(acquired.token_secret);
  if (!token) {
    await recordLlmAccountTransportOutcome({
      accountId: acquired.account_id,
      reservationId: acquired.reservation_id,
      status: 'auth_failed',
      errorMessage: 'Codex account token secret is missing or invalid.',
    });
    return null;
  }

  const freshToken = await refreshCodexTokenIfNeeded({
    accountId: acquired.account_id,
    externalAccountId: acquired.external_account_id,
    token,
  });
  if (!freshToken) {
    await recordLlmAccountTransportOutcome({
      accountId: acquired.account_id,
      reservationId: acquired.reservation_id,
      status: 'auth_failed',
      errorMessage: 'Codex account requires reauthentication.',
    });
    return null;
  }

  return {
    accessToken: freshToken.accessToken,
    accountId: acquired.external_account_id,
    accountLabel: acquired.account_label,
    stableSessionId: acquired.stable_session_id,
    accountTransportAccountId: acquired.account_id,
    leaseId: acquired.lease_id,
    reservationId: acquired.reservation_id,
    recordOutcome: (outcome) =>
      recordLlmAccountTransportOutcome({
        ...outcome,
        accountId: acquired!.account_id,
        reservationId: acquired!.reservation_id,
      }),
  };
};

export const recordLlmAccountTransportOutcome = async (
  input: LlmAccountTransportOutcomeInput & {
    accountId: string;
    reservationId: string;
  },
): Promise<void> => {
  const now = new Date();
  await db.run(sql`
    UPDATE llm_account_reservations
    SET status = 'completed', completed_at = ${now}
    WHERE id = ${input.reservationId} AND status = 'active'
  `);

  if (input.status === 'success') return;

  if (input.status === 'auth_failed') {
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'reauth_required',
          last_error = ${input.errorMessage ?? 'Account transport authorization failed.'},
          updated_at = ${now}
      WHERE id = ${input.accountId}
    `);
    return;
  }

  if (input.status === 'rate_limited') {
    const retryAfterMs =
      typeof input.retryAfterMs === 'number' && Number.isFinite(input.retryAfterMs)
        ? Math.max(0, input.retryAfterMs)
        : 60_000;
    const cooldownUntil = new Date(now.getTime() + retryAfterMs);
    await db.run(sql`
      UPDATE llm_provider_accounts
      SET status = 'cooldown',
          cooldown_until = ${cooldownUntil},
          last_error = ${input.errorMessage ?? 'Account transport rate limited.'},
          updated_at = ${now}
      WHERE id = ${input.accountId}
    `);
  }
};
