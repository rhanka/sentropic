import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../db/client';
import { sql } from 'drizzle-orm';
import { createSession, revokeSession } from '../../services/session-manager';
import {
  completeCodexEnrollment,
  disconnectCodexEnrollment,
  listProviderConnections,
  startCodexEnrollment,
} from '../../services/provider-connections';

const settingsSchema = z.object({
  openaiModels: z.record(z.string()).default({}),
  prompts: z.record(z.any()).default({}),
  generationLimits: z.record(z.any()).default({})
});

const codexEnrollmentStartSchema = z.object({
  accountLabel: z.string().trim().max(120).optional().nullable(),
});

const codexEnrollmentCompleteSchema = z.object({
  enrollmentId: z.string().trim().min(1),
  accountLabel: z.string().trim().max(120).optional().nullable(),
});

export const settingsRouter = new Hono();

const VSCODE_EXTENSION_TOKEN_META_KEY = 'vscode_extension_token_meta';

type VsCodeExtensionTokenMeta = {
  sessionId: string;
  issuedByUserId: string;
  issuedAt: string;
  expiresAt: string;
  last4: string;
  revokedAt: string | null;
};

type VsCodeExtensionTokenPublicMeta = Omit<VsCodeExtensionTokenMeta, 'sessionId'>;

const parseVsCodeExtensionTokenMeta = (
  raw: string | undefined,
): VsCodeExtensionTokenMeta | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VsCodeExtensionTokenMeta> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.issuedByUserId !== 'string' ||
      typeof parsed.issuedAt !== 'string' ||
      typeof parsed.expiresAt !== 'string' ||
      typeof parsed.last4 !== 'string'
    ) {
      return null;
    }
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

const readVsCodeExtensionTokenMeta = async (): Promise<VsCodeExtensionTokenMeta | null> => {
  const record = (await db.get(
    sql`SELECT value FROM settings WHERE key = ${VSCODE_EXTENSION_TOKEN_META_KEY} AND user_id IS NULL`,
  )) as { value?: string } | undefined;
  return parseVsCodeExtensionTokenMeta(record?.value);
};

const writeVsCodeExtensionTokenMeta = async (
  meta: VsCodeExtensionTokenMeta,
): Promise<void> => {
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES (${VSCODE_EXTENSION_TOKEN_META_KEY}, NULL, ${JSON.stringify(meta)}, 'VSCode extension bootstrap token metadata', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
};

const toPublicMeta = (
  meta: VsCodeExtensionTokenMeta | null,
): VsCodeExtensionTokenPublicMeta | null => {
  if (!meta) return null;
  return {
    issuedByUserId: meta.issuedByUserId,
    issuedAt: meta.issuedAt,
    expiresAt: meta.expiresAt,
    last4: meta.last4,
    revokedAt: meta.revokedAt,
  };
};

const isTokenMetaActive = (meta: VsCodeExtensionTokenMeta | null): boolean => {
  if (!meta) return false;
  if (meta.revokedAt) return false;
  const expiresAt = Date.parse(meta.expiresAt);
  if (Number.isNaN(expiresAt)) return false;
  return expiresAt > Date.now();
};

settingsRouter.get('/vscode-extension-token', async (c) => {
  const meta = await readVsCodeExtensionTokenMeta();
  return c.json({
    active: isTokenMetaActive(meta),
    meta: toPublicMeta(meta),
  });
});

settingsRouter.post('/vscode-extension-token', async (c) => {
  const user = c.get('user');
  if (!user?.userId || !user?.role) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  const previousMeta = await readVsCodeExtensionTokenMeta();
  if (previousMeta?.sessionId && !previousMeta.revokedAt) {
    await revokeSession(previousMeta.sessionId).catch(() => undefined);
  }

  const issued = await createSession(user.userId, user.role, {
    name: 'VSCode Extension Bootstrap Token',
  });

  const meta: VsCodeExtensionTokenMeta = {
    sessionId: issued.sessionId,
    issuedByUserId: user.userId,
    issuedAt: new Date().toISOString(),
    expiresAt: issued.expiresAt.toISOString(),
    last4: issued.sessionToken.slice(-4),
    revokedAt: null,
  };

  await writeVsCodeExtensionTokenMeta(meta);

  return c.json({
    active: true,
    token: issued.sessionToken,
    meta: toPublicMeta(meta),
  });
});

settingsRouter.delete('/vscode-extension-token', async (c) => {
  const meta = await readVsCodeExtensionTokenMeta();
  if (!meta?.sessionId || meta.revokedAt) {
    return c.json({
      revoked: false,
      active: false,
      meta: toPublicMeta(meta),
    });
  }

  await revokeSession(meta.sessionId).catch(() => undefined);
  const revokedMeta: VsCodeExtensionTokenMeta = {
    ...meta,
    revokedAt: new Date().toISOString(),
  };
  await writeVsCodeExtensionTokenMeta(revokedMeta);

  return c.json({
    revoked: true,
    active: false,
    meta: toPublicMeta(revokedMeta),
  });
});

settingsRouter.get('/provider-connections', async (c) => {
  const user = c.get('user') as { userId?: string } | undefined;
  const providers = await listProviderConnections({ userId: user?.userId ?? null });
  return c.json({ providers });
});

settingsRouter.post(
  '/provider-connections/codex/enrollment/start',
  zValidator('json', codexEnrollmentStartSchema),
  async (c) => {
    const user = c.get('user') as { userId?: string } | undefined;
    if (!user?.userId) {
      return c.json({ message: 'Authentication required' }, 401);
    }
    const payload = c.req.valid('json');
    const provider = await startCodexEnrollment({
      accountLabel: payload.accountLabel ?? null,
      updatedByUserId: user.userId,
    });
    return c.json({ provider });
  },
);

settingsRouter.post(
  '/provider-connections/codex/enrollment/complete',
  zValidator('json', codexEnrollmentCompleteSchema),
  async (c) => {
    const user = c.get('user') as { userId?: string } | undefined;
    if (!user?.userId) {
      return c.json({ message: 'Authentication required' }, 401);
    }
    const payload = c.req.valid('json');
    try {
      const provider = await completeCodexEnrollment({
        enrollmentId: payload.enrollmentId,
        accountLabel: payload.accountLabel ?? null,
        updatedByUserId: user.userId,
      });
      return c.json({ provider });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Enrollment completion failed';
      return c.json({ message }, 400);
    }
  },
);

settingsRouter.post('/provider-connections/codex/enrollment/disconnect', async (c) => {
  const user = c.get('user') as { userId?: string } | undefined;
  if (!user?.userId) {
    return c.json({ message: 'Authentication required' }, 401);
  }
  const provider = await disconnectCodexEnrollment({
    updatedByUserId: user.userId,
  });
  return c.json({ provider });
});

settingsRouter.get('/', async (c) => {
  // Récupérer les paramètres depuis le système clé-valeur
  const openaiModelsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'openai_models' AND user_id IS NULL`) as { value: string } | undefined;
  const promptsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'prompts' AND user_id IS NULL`) as { value: string } | undefined;
  const generationLimitsRecord = await db.get(sql`SELECT value FROM settings WHERE key = 'generation_limits' AND user_id IS NULL`) as { value: string } | undefined;

  return c.json({
    openaiModels: openaiModelsRecord?.value ? JSON.parse(openaiModelsRecord.value) : {},
    prompts: promptsRecord?.value ? JSON.parse(promptsRecord.value) : {},
    generationLimits: generationLimitsRecord?.value ? JSON.parse(generationLimitsRecord.value) : {}
  });
});

settingsRouter.put('/', zValidator('json', settingsSchema), async (c) => {
  const payload = c.req.valid('json');
  
  // Mettre à jour les paramètres dans le système clé-valeur
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('openai_models', NULL, ${JSON.stringify(payload.openaiModels)}, 'Configured OpenAI models', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
  
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('prompts', NULL, ${JSON.stringify(payload.prompts)}, 'Configured prompts', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);
  
  await db.run(sql`
    INSERT INTO settings (key, user_id, value, description, updated_at)
    VALUES ('generation_limits', NULL, ${JSON.stringify(payload.generationLimits)}, 'Generation limits', ${new Date().toISOString()})
    ON CONFLICT (key) WHERE user_id IS NULL
    DO UPDATE SET
      value = EXCLUDED.value,
      description = EXCLUDED.description,
      updated_at = EXCLUDED.updated_at
  `);

  return c.json(payload);
});
