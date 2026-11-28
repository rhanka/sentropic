import { PASSKEY_FRESH_ACR, validateRedirectUri, type OAuthContinuationCodec, type OauthClientRecord } from '@sentropic/auth-hono';
import { lt } from 'drizzle-orm';
import type { PoolClient } from 'pg';

import { db } from '../../db/client';
import { magicLinkContinuations } from '../../db/schema';

const AUTHORIZE_PATHS = new Set([
  '/oauth/authorize',
  '/api/v1/oauth/authorize',
  '/api/v1/auth/oauth/authorize',
]);

const ALLOWED_INTERNAL_RETURN_PREFIXES = [
  '/auth/oauth/consent',
  '/auth/signed-in',
  '/auth/devices',
  '/dashboard',
  '/settings',
  '/workspaces',
] as const;

export type ResolveMagicLinkContinuationResult =
  | { ok: true; continuationUrl: string | null; expiresAt: Date | null }
  | { ok: false; code: string; message: string };

export type ConsumeMagicLinkContinuationResult =
  | { status: 'ok'; continuationUrl: string }
  | { status: 'expired' }
  | { status: 'missing' };

const hasControlChars = (value: string): boolean => /[\x00-\x1f\x7f]/u.test(value);

const isAllowedInternalPath = (pathname: string): boolean =>
  ALLOWED_INTERNAL_RETURN_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );

const validateOAuthContinuationToken = async (
  continuation: string,
  oauthAuthorizePath: string,
  stateCodec: OAuthContinuationCodec,
  findClient: (clientId: string) => Promise<OauthClientRecord | null>,
  now: Date,
): Promise<ResolveMagicLinkContinuationResult> => {
  let payload = null;
  try {
    payload = await stateCodec.unseal(continuation);
  } catch {
    payload = null;
  }
  const sealedExpiresAt = payload ? new Date(payload.expiresAt) : null;
  if (
    !payload ||
    payload.userId ||
    payload.codeChallengeMethod !== 'S256' ||
    !sealedExpiresAt ||
    Number.isNaN(sealedExpiresAt.getTime()) ||
    sealedExpiresAt <= now
  ) {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Magic link continuation is invalid or expired.',
    };
  }

  const client = await findClient(payload.clientId);
  if (
    !client ||
    validateRedirectUri(client, payload.redirectUri) !== null ||
    !client.magicLinkSignIn ||
    client.requiredAcr === PASSKEY_FRESH_ACR
  ) {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Magic link sign-in is not permitted for this client.',
    };
  }

  const normalizedAuthorizePath = oauthAuthorizePath.replace(/\/+$/u, '');
  return {
    ok: true,
    continuationUrl: `${normalizedAuthorizePath}?continue=${encodeURIComponent(continuation)}`,
    expiresAt: sealedExpiresAt,
  };
};

export const resolveMagicLinkContinuation = async (input: {
  continuation?: string;
  returnUrl?: string;
  oauthAuthorizePath: string;
  stateCodec: OAuthContinuationCodec;
  findClient: (clientId: string) => Promise<OauthClientRecord | null>;
  now: Date;
}): Promise<ResolveMagicLinkContinuationResult> => {
  if (input.continuation !== undefined) {
    return validateOAuthContinuationToken(
      input.continuation,
      input.oauthAuthorizePath,
      input.stateCodec,
      input.findClient,
      input.now,
    );
  }

  if (input.returnUrl === undefined) {
    return { ok: true, continuationUrl: null, expiresAt: null };
  }

  const raw = input.returnUrl.trim();
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\') || hasControlChars(raw)) {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Invalid magic link continuation URL.',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(raw, 'https://idp.local');
  } catch {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Invalid magic link continuation URL.',
    };
  }

  if (parsed.origin !== 'https://idp.local' || parsed.hash) {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Invalid magic link continuation URL.',
    };
  }

  if (AUTHORIZE_PATHS.has(parsed.pathname)) {
    const nestedContinue = parsed.searchParams.get('continue');
    if (!nestedContinue) {
      return {
        ok: false,
        code: 'invalid_continuation',
        message: 'OAuth authorize continuation requires a valid continue token.',
      };
    }
    return validateOAuthContinuationToken(
      nestedContinue,
      input.oauthAuthorizePath,
      input.stateCodec,
      input.findClient,
      input.now,
    );
  }

  if (!isAllowedInternalPath(parsed.pathname)) {
    return {
      ok: false,
      code: 'invalid_continuation',
      message: 'Magic link returnUrl is not an allowed path.',
    };
  }

  return {
    ok: true,
    continuationUrl: `${parsed.pathname}${parsed.search}`,
    expiresAt: null,
  };
};

const hasQuery = (hostTx: unknown): hostTx is Pick<PoolClient, 'query'> =>
  Boolean(hostTx && typeof (hostTx as { query?: unknown }).query === 'function');

export const saveMagicLinkContinuation = async (
  hostTx: unknown,
  input: { tokenHash: string; continuationUrl: string; expiresAt: Date },
): Promise<void> => {
  if (!hasQuery(hostTx)) return;
  await hostTx.query(
    `INSERT INTO public.magic_link_continuations (token_hash, continuation_url, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (token_hash) DO UPDATE SET continuation_url = EXCLUDED.continuation_url, expires_at = EXCLUDED.expires_at`,
    [input.tokenHash, input.continuationUrl, input.expiresAt],
  );
};

export const consumeMagicLinkContinuation = async (
  hostTx: unknown,
  tokenHash: string,
  now: Date,
): Promise<ConsumeMagicLinkContinuationResult> => {
  if (!hasQuery(hostTx)) return { status: 'missing' };
  const result = await hostTx.query<{ continuation_url: string; expires_at: Date | string }>(
    `DELETE FROM public.magic_link_continuations WHERE token_hash = $1 RETURNING continuation_url, expires_at`,
    [tokenHash],
  );
  const row = result.rows[0];
  if (!row) return { status: 'missing' };
  if (new Date(row.expires_at) <= now) return { status: 'expired' };
  return { status: 'ok', continuationUrl: row.continuation_url };
};

export const purgeExpiredMagicLinkContinuations = async (now: Date = new Date()): Promise<number> => {
  const deleted = await db
    .delete(magicLinkContinuations)
    .where(lt(magicLinkContinuations.expiresAt, now))
    .returning({ tokenHash: magicLinkContinuations.tokenHash });
  return deleted.length;
};
