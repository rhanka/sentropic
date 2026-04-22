import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthUser } from '../../middleware/auth';
import { requireWorkspaceAccess } from '../../services/workspace-access';
import {
  disconnectGoogleDriveConnectorAccount,
  getGoogleDriveConnection,
  markGoogleDriveConnectorError,
  storeGoogleDriveTokenMaterial,
} from '../../services/google-drive-connector-accounts';
import {
  appendGoogleDriveOAuthResultToReturnPath,
  exchangeGoogleDriveOAuthCode,
  resolveGoogleDriveAccountIdentity,
  resolveGoogleDriveOAuthConfig,
  startGoogleDriveOAuth,
  verifyGoogleDriveOAuthState,
} from '../../services/google-drive-oauth';

export const googleDriveRouter = new Hono();

const oauthStartSchema = z.object({
  returnPath: z.string().trim().max(512).optional().nullable(),
});

const getAuthenticatedUser = (user: AuthUser | undefined): AuthUser | null =>
  user?.userId ? user : null;

const ensureWorkspace = async (user: AuthUser, workspaceId: string): Promise<boolean> => {
  if (!workspaceId) return false;
  try {
    await requireWorkspaceAccess(user.userId, workspaceId);
    return true;
  } catch {
    return false;
  }
};

const wantsJsonResponse = (request: Request, format: string | undefined): boolean => {
  if (format === 'json') return true;
  return request.headers.get('accept')?.includes('application/json') ?? false;
};

const toErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

googleDriveRouter.get('/connection', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) {
    return c.json({ message: 'Workspace access required' }, 403);
  }

  return c.json({
    account: await getGoogleDriveConnection({
      userId: user.userId,
      workspaceId: user.workspaceId,
    }),
  });
});

googleDriveRouter.post('/oauth/start', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) {
    return c.json({ message: 'Workspace access required' }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = oauthStartSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ message: 'Invalid Google Drive OAuth start request' }, 400);
  }

  try {
    return c.json(
      await startGoogleDriveOAuth({
        userId: user.userId,
        workspaceId: user.workspaceId,
        returnPath: parsed.data.returnPath ?? null,
      }),
    );
  } catch (error) {
    return c.json({ message: toErrorMessage(error, 'Google Drive OAuth start failed') }, 503);
  }
});

googleDriveRouter.get('/oauth/callback', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);

  const rawState = c.req.query('state') ?? '';
  const json = wantsJsonResponse(c.req.raw, c.req.query('format'));
  let state;
  try {
    state = verifyGoogleDriveOAuthState(rawState);
  } catch (error) {
    return c.json({ message: toErrorMessage(error, 'Invalid Google Drive OAuth state') }, 400);
  }

  if (state.userId !== user.userId || !(await ensureWorkspace(user, state.workspaceId))) {
    return c.json({ message: 'Google Drive OAuth state does not match this session' }, 403);
  }

  const googleError = c.req.query('error');
  if (googleError) {
    const account = await markGoogleDriveConnectorError({
      userId: user.userId,
      workspaceId: state.workspaceId,
      message: googleError,
    });
    if (json) return c.json({ account, message: googleError }, 400);
    return c.redirect(
      appendGoogleDriveOAuthResultToReturnPath(state.returnPath, {
        google_drive: 'error',
      }),
    );
  }

  const code = c.req.query('code')?.trim();
  if (!code) return c.json({ message: 'Missing Google Drive OAuth code' }, 400);

  try {
    const config = await resolveGoogleDriveOAuthConfig();
    if (!config) throw new Error('Google Drive OAuth is not configured.');

    const token = await exchangeGoogleDriveOAuthCode({ code, config });
    const identity = await resolveGoogleDriveAccountIdentity({ token });
    const account = await storeGoogleDriveTokenMaterial({
      userId: user.userId,
      workspaceId: state.workspaceId,
      token,
      identity,
    });

    if (json) return c.json({ account, returnPath: state.returnPath });
    return c.redirect(
      appendGoogleDriveOAuthResultToReturnPath(state.returnPath, {
        google_drive: 'connected',
      }),
    );
  } catch (error) {
    const message = toErrorMessage(error, 'Google Drive OAuth callback failed');
    const account = await markGoogleDriveConnectorError({
      userId: user.userId,
      workspaceId: state.workspaceId,
      message,
    });
    if (json) return c.json({ account, message }, 400);
    return c.redirect(
      appendGoogleDriveOAuthResultToReturnPath(state.returnPath, {
        google_drive: 'error',
      }),
    );
  }
});

googleDriveRouter.post('/disconnect', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) {
    return c.json({ message: 'Workspace access required' }, 403);
  }

  return c.json({
    account: await disconnectGoogleDriveConnectorAccount({
      userId: user.userId,
      workspaceId: user.workspaceId,
    }),
  });
});
