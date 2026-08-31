import { z } from 'zod';
import {
  disconnectGoogleDriveConnectorAccount,
  getGoogleDriveConnection,
  markGoogleDriveConnectorError,
  storeGoogleDriveTokenMaterial,
} from '../google-drive-connector-accounts';
import {
  exchangeGoogleDriveOAuthCode,
  resolveGoogleDriveAccountIdentity,
  type GoogleDriveOAuthStatePayload,
} from '../google-drive-oauth';
import {
  GMAIL_PROVIDER,
  resolveGmailOAuthConfig,
  startGmailOAuth,
  verifyGmailOAuthState,
} from '../gmail-oauth';
import {
  connectorErrorMessage,
  connectorReturnRedirect,
  ensureConnectorWorkspace,
  resolveConnectorRequestApiBaseUrl,
  wantsConnectorJsonResponse,
  type ProductConnectorAdminInput,
} from './admin-utils';
const oauthStartSchema = z.object({
  returnPath: z.string().trim().max(512).optional().nullable(),
});
export const completeGmailAdminOAuth = async (
  { context, principal }: ProductConnectorAdminInput,
  state: GoogleDriveOAuthStatePayload,
  requestApiBaseUrl: string,
  json: boolean,
): Promise<Response> => {
  if (state.userId !== principal.userId
    || !await ensureConnectorWorkspace(principal, state.workspaceId)) {
    return context.json({ message: 'Gmail OAuth state does not match this session' }, 403);
  }
  const googleError = context.req.query('error');
  if (googleError) {
    const account = await markGoogleDriveConnectorError({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      message: googleError,
      provider: GMAIL_PROVIDER,
    });
    if (json) return context.json({ account, message: googleError }, 400);
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { gmail: 'error' }, requestApiBaseUrl,
    ));
  }
  const code = context.req.query('code')?.trim();
  if (!code) return context.json({ message: 'Missing Gmail OAuth code' }, 400);
  try {
    const config = await resolveGmailOAuthConfig({ requestApiBaseUrl });
    if (!config) throw new Error('Gmail OAuth is not configured.');
    const token = await exchangeGoogleDriveOAuthCode({ code, config });
    const identity = await resolveGoogleDriveAccountIdentity({ token });
    const account = await storeGoogleDriveTokenMaterial({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      token,
      identity,
      provider: GMAIL_PROVIDER,
    });
    if (json) return context.json({ account, returnPath: state.returnPath });
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { gmail: 'connected' }, requestApiBaseUrl,
    ));
  } catch (error) {
    const message = connectorErrorMessage(error, 'Gmail OAuth callback failed');
    const account = await markGoogleDriveConnectorError({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      message,
      provider: GMAIL_PROVIDER,
    });
    if (json) return context.json({ account, message }, 400);
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { gmail: 'error' }, requestApiBaseUrl,
    ));
  }
};
export const readGmailConnection = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  return context.json({
    account: await getGoogleDriveConnection(principal, {
      validateToken: true,
      provider: GMAIL_PROVIDER,
    }),
  });
};
export const startGmailAdminOAuth = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  const parsed = oauthStartSchema.safeParse(await context.req.json().catch(() => ({})));
  if (!parsed.success) return context.json({ message: 'Invalid Gmail OAuth start request' }, 400);
  try {
    return context.json(await startGmailOAuth({
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      returnPath: parsed.data.returnPath ?? null,
      requestApiBaseUrl: resolveConnectorRequestApiBaseUrl(context.req.raw),
    }));
  } catch (error) {
    return context.json({ message: connectorErrorMessage(error, 'Gmail OAuth start failed') }, 503);
  }
};

export const completeGmailAdminOAuthCallback = async (
  input: ProductConnectorAdminInput,
): Promise<Response> => {
  const requestApiBaseUrl = resolveConnectorRequestApiBaseUrl(input.context.req.raw);
  const json = wantsConnectorJsonResponse(
    input.context.req.raw,
    input.context.req.query('format'),
  );
  try {
    const state = verifyGmailOAuthState(input.context.req.query('state') ?? '');
    return completeGmailAdminOAuth(input, state, requestApiBaseUrl, json);
  } catch (error) {
    return input.context.json({
      message: connectorErrorMessage(error, 'Invalid Gmail OAuth state'),
    }, 400);
  }
};

export const disconnectGmail = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  return context.json({
    account: await disconnectGoogleDriveConnectorAccount({
      ...principal,
      provider: GMAIL_PROVIDER,
    }),
  });
};
