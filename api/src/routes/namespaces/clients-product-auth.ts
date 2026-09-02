import { sql } from 'drizzle-orm';
import { Hono } from 'hono';

import { db } from '../../db/client';
import { createSession, revokeSession } from '../../services/session-manager';

const TOKEN_META_KEY = 'vscode_extension_token_meta';

interface TokenMeta {
  sessionId: string;
  issuedByUserId: string;
  issuedAt: string;
  expiresAt: string;
  last4: string;
  revokedAt: string | null;
}

type PublicTokenMeta = Omit<TokenMeta, 'sessionId'>;

const parseTokenMeta = (raw: string | undefined): TokenMeta | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TokenMeta> | null;
    if (!parsed || typeof parsed !== 'object'
      || typeof parsed.sessionId !== 'string'
      || typeof parsed.issuedByUserId !== 'string'
      || typeof parsed.issuedAt !== 'string'
      || typeof parsed.expiresAt !== 'string'
      || typeof parsed.last4 !== 'string') return null;
    return {
      sessionId: parsed.sessionId,
      issuedByUserId: parsed.issuedByUserId,
      issuedAt: parsed.issuedAt,
      expiresAt: parsed.expiresAt,
      last4: parsed.last4,
      revokedAt: typeof parsed.revokedAt === 'string' ? parsed.revokedAt : null,
    };
  } catch {
    return null;
  }
};

const readTokenMeta = async (): Promise<TokenMeta | null> => {
  const record = await db.get(sql`
    SELECT value FROM settings WHERE key = ${TOKEN_META_KEY} AND user_id IS NULL
  `) as { value?: string } | undefined;
  return parseTokenMeta(record?.value);
};

const writeTokenMeta = async (meta: TokenMeta): Promise<void> => {
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES (${TOKEN_META_KEY}, NULL, ${JSON.stringify(meta)},
      'VSCode extension bootstrap token metadata', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET value = EXCLUDED.value, description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
};

const toPublicMeta = (meta: TokenMeta | null): PublicTokenMeta | null => meta && ({
  issuedByUserId: meta.issuedByUserId,
  issuedAt: meta.issuedAt,
  expiresAt: meta.expiresAt,
  last4: meta.last4,
  revokedAt: meta.revokedAt,
});

const isActive = (meta: TokenMeta | null): boolean => {
  if (!meta || meta.revokedAt) return false;
  const expiresAt = Date.parse(meta.expiresAt);
  return !Number.isNaN(expiresAt) && expiresAt > Date.now();
};

export const clientSettingsRouter = new Hono();

clientSettingsRouter.get('/vscode-extension-token', async (context) => {
  const meta = await readTokenMeta();
  return context.json({ active: isActive(meta), meta: toPublicMeta(meta) });
});

clientSettingsRouter.post('/vscode-extension-token', async (context) => {
  const user = context.get('user');
  if (!user?.userId || !user?.role) {
    return context.json({ message: 'Authentication required' }, 401);
  }
  const previousMeta = await readTokenMeta();
  if (previousMeta?.sessionId && !previousMeta.revokedAt) {
    await revokeSession(previousMeta.sessionId).catch(() => undefined);
  }
  const issued = await createSession(user.userId, user.role, {
    name: 'VSCode Extension Bootstrap Token',
  });
  const meta: TokenMeta = {
    sessionId: issued.sessionId,
    issuedByUserId: user.userId,
    issuedAt: new Date().toISOString(),
    expiresAt: issued.expiresAt.toISOString(),
    last4: issued.sessionToken.slice(-4),
    revokedAt: null,
  };
  await writeTokenMeta(meta);
  return context.json({ active: true, token: issued.sessionToken, meta: toPublicMeta(meta) });
});

clientSettingsRouter.delete('/vscode-extension-token', async (context) => {
  const meta = await readTokenMeta();
  if (!meta?.sessionId || meta.revokedAt) {
    return context.json({ revoked: false, active: false, meta: toPublicMeta(meta) });
  }
  await revokeSession(meta.sessionId).catch(() => undefined);
  const revokedMeta = { ...meta, revokedAt: new Date().toISOString() };
  await writeTokenMeta(revokedMeta);
  return context.json({ revoked: true, active: false, meta: toPublicMeta(revokedMeta) });
});
