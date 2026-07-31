import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthUser } from '../../middleware/auth';
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
  resolveGoogleDriveAppReturnBaseUrl,
} from '../../services/google-drive-oauth';
import {
  GMAIL_PROVIDER,
  resolveGmailOAuthConfig,
  startGmailOAuth,
  verifyGmailOAuthState,
} from '../../services/gmail-oauth';
import { requireWorkspaceAccess } from '../../services/workspace-access';

export const gmailRouter = new Hono();

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

const firstForwardedValue = (value: string | null): string | null => {
  const first = value?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
};

const resolveRequestApiBaseUrl = (request: Request): string => {
  const requestUrl = new URL(request.url);
  const host = firstForwardedValue(request.headers.get('x-forwarded-host')) ||
    firstForwardedValue(request.headers.get('host'));
  if (!host) return requestUrl.origin;
  const protocol = firstForwardedValue(request.headers.get('x-forwarded-proto')) ||
    requestUrl.protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
};

const wantsJsonResponse = (request: Request, format: string | undefined): boolean =>
  format === 'json' || (request.headers.get('accept')?.includes('application/json') ?? false);

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

const gmailReturnRedirect = (
  returnPath: string,
  params: Record<string, string>,
  requestApiBaseUrl: string,
): string => appendGoogleDriveOAuthResultToReturnPath(returnPath, params, {
  baseUrl: resolveGoogleDriveAppReturnBaseUrl({ requestApiBaseUrl }),
});

gmailRouter.get('/connection', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) return c.json({ message: 'Workspace access required' }, 403);
  return c.json({ account: await getGoogleDriveConnection(user, { validateToken: true, provider: GMAIL_PROVIDER }) });
});

gmailRouter.post('/oauth/start', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) return c.json({ message: 'Workspace access required' }, 403);
  const parsed = oauthStartSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ message: 'Invalid Gmail OAuth start request' }, 400);
  try {
    return c.json(await startGmailOAuth({
      userId: user.userId,
      workspaceId: user.workspaceId,
      returnPath: parsed.data.returnPath ?? null,
      requestApiBaseUrl: resolveRequestApiBaseUrl(c.req.raw),
    }));
  } catch (error) {
    return c.json({ message: errorMessage(error, 'Gmail OAuth start failed') }, 503);
  }
});

gmailRouter.get('/oauth/callback', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  const requestApiBaseUrl = resolveRequestApiBaseUrl(c.req.raw);
  const json = wantsJsonResponse(c.req.raw, c.req.query('format'));
  let state;
  try {
    state = verifyGmailOAuthState(c.req.query('state') ?? '');
  } catch (error) {
    return c.json({ message: errorMessage(error, 'Invalid Gmail OAuth state') }, 400);
  }
  if (state.userId !== user.userId || !(await ensureWorkspace(user, state.workspaceId))) {
    return c.json({ message: 'Gmail OAuth state does not match this session' }, 403);
  }
  const googleError = c.req.query('error');
  if (googleError) {
    const account = await markGoogleDriveConnectorError({
      userId: user.userId, workspaceId: state.workspaceId, message: googleError, provider: GMAIL_PROVIDER,
    });
    if (json) return c.json({ account, message: googleError }, 400);
    return c.redirect(gmailReturnRedirect(state.returnPath, { gmail: 'error' }, requestApiBaseUrl));
  }
  const code = c.req.query('code')?.trim();
  if (!code) return c.json({ message: 'Missing Gmail OAuth code' }, 400);
  try {
    const config = await resolveGmailOAuthConfig({ requestApiBaseUrl });
    if (!config) throw new Error('Gmail OAuth is not configured.');
    const token = await exchangeGoogleDriveOAuthCode({ code, config });
    const identity = await resolveGoogleDriveAccountIdentity({ token });
    const account = await storeGoogleDriveTokenMaterial({
      userId: user.userId, workspaceId: state.workspaceId, token, identity, provider: GMAIL_PROVIDER,
    });
    if (json) return c.json({ account, returnPath: state.returnPath });
    return c.redirect(gmailReturnRedirect(state.returnPath, { gmail: 'connected' }, requestApiBaseUrl));
  } catch (error) {
    const message = errorMessage(error, 'Gmail OAuth callback failed');
    const account = await markGoogleDriveConnectorError({
      userId: user.userId, workspaceId: state.workspaceId, message, provider: GMAIL_PROVIDER,
    });
    if (json) return c.json({ account, message }, 400);
    return c.redirect(gmailReturnRedirect(state.returnPath, { gmail: 'error' }, requestApiBaseUrl));
  }
});

gmailRouter.post('/disconnect', async (c) => {
  const user = getAuthenticatedUser(c.get('user'));
  if (!user) return c.json({ message: 'Authentication required' }, 401);
  if (!(await ensureWorkspace(user, user.workspaceId))) return c.json({ message: 'Workspace access required' }, 403);
  return c.json({ account: await disconnectGoogleDriveConnectorAccount({ ...user, provider: GMAIL_PROVIDER }) });
});
