import { apiGet, apiPost } from './api';

export type GmailConnectionStatus = 'connected' | 'disconnected' | 'error';

export type GmailConnection = {
  id: string | null;
  provider: 'gmail';
  status: GmailConnectionStatus;
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

type GmailConnectionPayload = {
  account: GmailConnection;
};

type GmailOAuthStartPayload = {
  authorizationUrl: string;
};

type GmailGetRequester = (path: string) => Promise<GmailConnectionPayload>;

type GmailOAuthStartRequester = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<GmailOAuthStartPayload>;

type GmailConnectionPostRequester = (
  path: string,
  body?: Record<string, unknown>,
) => Promise<GmailConnectionPayload>;

export const fetchGmailConnection = async (): Promise<GmailConnection> =>
  fetchGmailConnectionWith((path) => apiGet<GmailConnectionPayload>(path));

export const fetchGmailConnectionWith = async (
  requester: GmailGetRequester,
): Promise<GmailConnection> => {
  const payload = await requester('/gmail/connection');
  return payload.account;
};

export const startGmailOAuth = async (input: {
  returnPath?: string | null;
}): Promise<string> =>
  startGmailOAuthWith(input, (path, body) =>
    apiPost<GmailOAuthStartPayload>(path, body ?? {}),
  );

export const startGmailOAuthWith = async (
  input: {
    returnPath?: string | null;
  },
  requester: GmailOAuthStartRequester,
): Promise<string> => {
  const payload = await requester('/gmail/oauth/start', {
    returnPath: input.returnPath ?? null,
  });
  return payload.authorizationUrl;
};

export const disconnectGmail = async (): Promise<GmailConnection> =>
  disconnectGmailWith((path, body) =>
    apiPost<GmailConnectionPayload>(path, body ?? {}),
  );

export const disconnectGmailWith = async (
  requester: GmailConnectionPostRequester,
): Promise<GmailConnection> => {
  const payload = await requester('/gmail/disconnect', {});
  return payload.account;
};
