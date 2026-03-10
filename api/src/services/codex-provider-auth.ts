const CODEX_AUTH_ISSUER = 'https://auth.openai.com';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const CODEX_DEVICE_AUTH_URL = `${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/usercode`;
const CODEX_DEVICE_TOKEN_URL = `${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/token`;
const CODEX_OAUTH_TOKEN_URL = `${CODEX_AUTH_ISSUER}/oauth/token`;
const CODEX_VERIFICATION_URL = `${CODEX_AUTH_ISSUER}/codex/device`;
const CODEX_REDIRECT_URI = `${CODEX_AUTH_ISSUER}/deviceauth/callback`;

export type CodexDeviceEnrollmentPending = {
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
};

export type CodexDeviceEnrollmentResult = {
  idToken: string;
  refreshToken: string;
  apiKey: string;
};

const normalizeIntervalSeconds = (value: unknown): number => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 5;
  return Math.max(1, Math.min(parsed, 10));
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const readJsonOrThrow = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const payload = (await response.json().catch(() => null)) as T | { error?: string; message?: string } | null;
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? (payload as { error?: string; message?: string }).error ||
          (payload as { error?: string; message?: string }).message
        : null;
    throw new Error(message || fallbackMessage);
  }
  return payload as T;
};

const exchangeAuthorizationCode = async (input: {
  authorizationCode: string;
  codeVerifier: string;
}): Promise<{ idToken: string; refreshToken: string }> => {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.authorizationCode,
    redirect_uri: CODEX_REDIRECT_URI,
    client_id: CODEX_CLIENT_ID,
    code_verifier: input.codeVerifier,
  });
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  const payload = await readJsonOrThrow<{
    id_token?: string;
    refresh_token?: string;
  }>(response, 'Codex token exchange failed.');
  if (!payload.id_token || !payload.refresh_token) {
    throw new Error('Codex token exchange returned an incomplete credential set.');
  }
  return {
    idToken: payload.id_token,
    refreshToken: payload.refresh_token,
  };
};

const exchangeApiKey = async (idToken: string): Promise<string> => {
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
    client_id: CODEX_CLIENT_ID,
    requested_token: 'openai-api-key',
    subject_token: idToken,
    subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
  });
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body,
  });
  const payload = await readJsonOrThrow<{ access_token?: string }>(
    response,
    'Codex API key exchange failed.',
  );
  if (!payload.access_token) {
    throw new Error('Codex API key exchange did not return an API key.');
  }
  return payload.access_token;
};

export const startCodexDeviceEnrollment = async (): Promise<{
  deviceAuthId: string;
  userCode: string;
  intervalSeconds: number;
  verificationUrl: string;
}> => {
  const response = await fetch(CODEX_DEVICE_AUTH_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: CODEX_CLIENT_ID,
    }),
  });
  const payload = await readJsonOrThrow<{
    device_auth_id?: string;
    user_code?: string;
    interval?: string | number;
  }>(response, 'Unable to start Codex device enrollment.');
  if (!payload.device_auth_id || !payload.user_code) {
    throw new Error('Codex device enrollment did not return a device auth code.');
  }
  return {
    deviceAuthId: payload.device_auth_id,
    userCode: payload.user_code,
    intervalSeconds: normalizeIntervalSeconds(payload.interval),
    verificationUrl: CODEX_VERIFICATION_URL,
  };
};

export const completeCodexDeviceEnrollment = async (
  pending: CodexDeviceEnrollmentPending,
): Promise<CodexDeviceEnrollmentResult> => {
  const startedAt = Date.now();
  const waitMs = pending.intervalSeconds * 1000;

  for (;;) {
    const response = await fetch(CODEX_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        device_auth_id: pending.deviceAuthId,
        user_code: pending.userCode,
      }),
    });

    if (response.status === 403 || response.status === 404) {
      if (Date.now() - startedAt >= 30_000) {
        throw new Error('Codex authorization is still pending. Finish the OpenAI device login, then retry.');
      }
      await sleep(waitMs);
      continue;
    }

    const deviceToken = await readJsonOrThrow<{
      authorization_code?: string;
      code_verifier?: string;
    }>(response, 'Codex device authorization failed.');

    if (!deviceToken.authorization_code || !deviceToken.code_verifier) {
      throw new Error('Codex device authorization returned an incomplete code exchange payload.');
    }

    const { idToken, refreshToken } = await exchangeAuthorizationCode({
      authorizationCode: deviceToken.authorization_code,
      codeVerifier: deviceToken.code_verifier,
    });
    const apiKey = await exchangeApiKey(idToken);

    return {
      idToken,
      refreshToken,
      apiKey,
    };
  }
};
