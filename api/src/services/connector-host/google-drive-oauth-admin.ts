import { z } from 'zod';

import {
  markGoogleDriveConnectorError,
  storeGoogleDriveTokenMaterial,
} from '../google-drive-connector-accounts';
import {
  exchangeGoogleDriveOAuthCode,
  resolveGoogleDriveAccountIdentity,
  resolveGoogleDriveOAuthConfig,
  startGoogleDriveOAuth,
  verifyGoogleDriveOAuthState,
} from '../google-drive-oauth';
import {
  connectorErrorMessage,
  connectorReturnRedirect,
  ensureConnectorWorkspace,
  resolveConnectorRequestApiBaseUrl,
  wantsConnectorJsonResponse,
  type ProductConnectorAdminInput,
} from './admin-utils';
import { completeGmailAdminOAuth } from './gmail-admin';

const oauthStartSchema = z.object({
  returnPath: z.string().trim().max(512).optional().nullable(),
});

export const startGoogleDriveAdminOAuth = async (
  { context, principal }: ProductConnectorAdminInput,
): Promise<Response> => {
  if (!await ensureConnectorWorkspace(principal)) {
    return context.json({ message: 'Workspace access required' }, 403);
  }
  const parsed = oauthStartSchema.safeParse(await context.req.json().catch(() => ({})));
  if (!parsed.success) {
    return context.json({ message: 'Invalid Google Drive OAuth start request' }, 400);
  }
  try {
    return context.json(await startGoogleDriveOAuth({
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      returnPath: parsed.data.returnPath ?? null,
      requestApiBaseUrl: resolveConnectorRequestApiBaseUrl(context.req.raw),
    }));
  } catch (error) {
    return context.json({
      message: connectorErrorMessage(error, 'Google Drive OAuth start failed'),
    }, 503);
  }
};

export const completeGoogleDriveAdminOAuth = async (
  input: ProductConnectorAdminInput,
): Promise<Response> => {
  const { context, principal } = input;
  const requestApiBaseUrl = resolveConnectorRequestApiBaseUrl(context.req.raw);
  const json = wantsConnectorJsonResponse(context.req.raw, context.req.query('format'));
  let state;
  try {
    state = verifyGoogleDriveOAuthState(context.req.query('state') ?? '');
  } catch (error) {
    return context.json({
      message: connectorErrorMessage(error, 'Invalid Google Drive OAuth state'),
    }, 400);
  }
  if (state.provider === 'gmail') {
    return completeGmailAdminOAuth(input, state, requestApiBaseUrl, json);
  }
  if (state.userId !== principal.userId
    || !await ensureConnectorWorkspace(principal, state.workspaceId)) {
    return context.json({ message: 'Google Drive OAuth state does not match this session' }, 403);
  }
  const googleError = context.req.query('error');
  if (googleError) {
    const account = await markGoogleDriveConnectorError({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      message: googleError,
    });
    if (json) return context.json({ account, message: googleError }, 400);
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { google_drive: 'error' }, requestApiBaseUrl,
    ));
  }
  const code = context.req.query('code')?.trim();
  if (!code) return context.json({ message: 'Missing Google Drive OAuth code' }, 400);
  try {
    const config = await resolveGoogleDriveOAuthConfig({ requestApiBaseUrl });
    if (!config) throw new Error('Google Drive OAuth is not configured.');
    const token = await exchangeGoogleDriveOAuthCode({ code, config });
    const identity = await resolveGoogleDriveAccountIdentity({ token });
    const account = await storeGoogleDriveTokenMaterial({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      token,
      identity,
    });
    if (json) return context.json({ account, returnPath: state.returnPath });
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { google_drive: 'connected' }, requestApiBaseUrl,
    ));
  } catch (error) {
    const message = connectorErrorMessage(error, 'Google Drive OAuth callback failed');
    const account = await markGoogleDriveConnectorError({
      userId: principal.userId,
      workspaceId: state.workspaceId,
      message,
    });
    if (json) return context.json({ account, message }, 400);
    return context.redirect(connectorReturnRedirect(
      state.returnPath, { google_drive: 'error' }, requestApiBaseUrl,
    ));
  }
};
