import { createAuthUiError } from './errors.js';
import type {
  ApproveDevicePairingInput,
  ApproveDevicePairingResult,
  AuthUiTransport,
  CreatePasskeyAuthenticationOptionsInput,
  CreatePasskeyAuthenticationOptionsResult,
  CreatePasskeyRegistrationOptionsInput,
  CreatePasskeyRegistrationOptionsResult,
  ListCredentialsResult,
  RenameCredentialInput,
  RequestEmailCodeInput,
  RequestEmailCodeResult,
  RevokeCredentialInput,
  VerifyEmailCodeInput,
  VerifyEmailCodeResult,
  VerifyMagicLinkInput,
  VerifyPasskeyAuthenticationInput,
  VerifyPasskeyRegistrationInput,
} from './transport-types.js';
import type { AuthUiCredential, AuthUiResult, AuthUiSession } from './types.js';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface CreateDefaultFetchTransportOptions {
  /**
   * Base URL prefix mounted in front of the auth routes (e.g. "/auth", "/admin/auth").
   * No trailing slash.
   */
  baseUrl: string;
  fetch?: FetchLike;
  /**
   * Static headers merged into every request (e.g. tenant id, bearer token).
   */
  headers?: Record<string, string>;
  /**
   * Invoked when an authenticated request receives a 401 response, so hosts can
   * clear their session state and redirect to login.
   */
  onUnauthorized?: () => void | Promise<void>;
  /**
   * Toggle `credentials: "include"` so the browser sends cookies. Default `true`.
   */
  withCredentials?: boolean;
}

const safeJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const extractErrorMessage = (payload: unknown, fallback: string): string => {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }
    if (typeof record.error === 'string' && record.error) {
      return record.error;
    }
  }
  return fallback;
};

export const createDefaultFetchTransport = (
  options: CreateDefaultFetchTransportOptions,
): AuthUiTransport => {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);
  const withCredentials = options.withCredentials ?? true;

  if (!fetchImpl) {
    throw createAuthUiError(
      'invalid_input',
      'No global fetch found; pass options.fetch when constructing the auth transport.',
    );
  }

  const request = async <T>(
    path: string,
    init: { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; authenticated?: boolean },
  ): Promise<AuthUiResult<T>> => {
    const headers: Record<string, string> = { Accept: 'application/json', ...(options.headers ?? {}) };
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.body);
    }

    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: init.method,
        headers,
        body,
        credentials: withCredentials ? 'include' : 'same-origin',
      });
    } catch (cause) {
      return {
        ok: false,
        error: createAuthUiError('transport_error', 'Network request failed', { retryable: true, cause }),
      };
    }

    const payload = await safeJson(response);

    if (response.status === 401 && init.authenticated) {
      void options.onUnauthorized?.();
    }

    if (!response.ok) {
      const message = extractErrorMessage(payload, `Request failed with status ${response.status}`);
      return {
        ok: false,
        error: createAuthUiError('transport_error', message, {
          retryable: response.status >= 500,
          cause: payload,
        }),
      };
    }

    return { ok: true, value: payload as T };
  };

  return {
    requestEmailCode: (input: RequestEmailCodeInput) =>
      request<RequestEmailCodeResult>('/email/verify-request', { method: 'POST', body: input }),
    verifyEmailCode: (input: VerifyEmailCodeInput) =>
      request<VerifyEmailCodeResult>('/email/verify-code', { method: 'POST', body: input }),
    verifyMagicLink: (input: VerifyMagicLinkInput) =>
      request<AuthUiSession>('/magic-link/verify', { method: 'POST', body: input }),
    createPasskeyRegistrationOptions: (input: CreatePasskeyRegistrationOptionsInput) =>
      request<CreatePasskeyRegistrationOptionsResult>('/register/options', { method: 'POST', body: input }),
    verifyPasskeyRegistration: (input: VerifyPasskeyRegistrationInput) =>
      request<AuthUiSession>('/register/verify', { method: 'POST', body: input }),
    createPasskeyAuthenticationOptions: (input: CreatePasskeyAuthenticationOptionsInput) =>
      request<CreatePasskeyAuthenticationOptionsResult>('/login/options', { method: 'POST', body: input }),
    verifyPasskeyAuthentication: (input: VerifyPasskeyAuthenticationInput) =>
      request<AuthUiSession>('/login/verify', { method: 'POST', body: input }),
    refreshSession: () =>
      request<AuthUiSession>('/session/refresh', { method: 'POST', authenticated: true }),
    logout: () => request<void>('/session', { method: 'DELETE', authenticated: true }),
    listCredentials: () =>
      request<ListCredentialsResult>('/credentials', { method: 'GET', authenticated: true }),
    renameCredential: (input: RenameCredentialInput) =>
      request<AuthUiCredential>(`/credentials/${encodeURIComponent(input.credentialId)}`, {
        method: 'PUT',
        body: { deviceName: input.deviceName },
        authenticated: true,
      }),
    revokeCredential: (input: RevokeCredentialInput) =>
      request<void>(`/credentials/${encodeURIComponent(input.credentialId)}`, {
        method: 'DELETE',
        authenticated: true,
      }),
    approveDevicePairing: (input: ApproveDevicePairingInput) =>
      request<ApproveDevicePairingResult>('/device/approve', {
        method: 'POST',
        body: { user_code: input.userCode, device_name: input.deviceName },
        authenticated: true,
      }),
  };
};
