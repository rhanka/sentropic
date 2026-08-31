import type {
  ConnectorAdminHandlerInput,
  ConnectorAdminPrincipal,
} from '@sentropic/connector-host/hono';

import { appendGoogleDriveOAuthResultToReturnPath, resolveGoogleDriveAppReturnBaseUrl } from '../google-drive-oauth';
import { requireWorkspaceAccess } from '../workspace-access';

export type ProductConnectorAdminInput = ConnectorAdminHandlerInput;

export const ensureConnectorWorkspace = async (
  principal: ConnectorAdminPrincipal,
  workspaceId = principal.workspaceId,
): Promise<boolean> => {
  if (!workspaceId) return false;
  try {
    await requireWorkspaceAccess(principal.userId, workspaceId);
    return true;
  } catch {
    return false;
  }
};

const firstForwardedValue = (value: string | null): string | null => {
  const first = value?.split(',')[0]?.trim();
  return first && first.length > 0 ? first : null;
};

export const resolveConnectorRequestApiBaseUrl = (request: Request): string => {
  const requestUrl = new URL(request.url);
  const host = firstForwardedValue(request.headers.get('x-forwarded-host'))
    || firstForwardedValue(request.headers.get('host'));
  if (!host) return requestUrl.origin;
  const protocol = firstForwardedValue(request.headers.get('x-forwarded-proto'))
    || requestUrl.protocol.replace(/:$/, '');
  return `${protocol}://${host}`;
};

export const wantsConnectorJsonResponse = (
  request: Request,
  format: string | undefined,
): boolean => format === 'json'
  || (request.headers.get('accept')?.includes('application/json') ?? false);

export const connectorErrorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

export const connectorReturnRedirect = (
  returnPath: string,
  params: Record<string, string>,
  requestApiBaseUrl: string,
): string => appendGoogleDriveOAuthResultToReturnPath(returnPath, params, {
  baseUrl: resolveGoogleDriveAppReturnBaseUrl({ requestApiBaseUrl }),
});
