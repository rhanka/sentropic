import type {
  CompleteEnrollmentInput,
  EnrollmentProvider,
  EnrollmentSession,
  EnrollmentState,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

export const CODEX_AUTH_ISSUER = 'https://auth.openai.com';
export const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
export const CODEX_DEVICE_AUTH_URL = `${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/usercode`;
export const CODEX_DEVICE_TOKEN_URL = `${CODEX_AUTH_ISSUER}/api/accounts/deviceauth/token`;
export const CODEX_OAUTH_TOKEN_URL = `${CODEX_AUTH_ISSUER}/oauth/token`;
export const CODEX_VERIFICATION_URL = `${CODEX_AUTH_ISSUER}/codex/device`;

export interface CodexEnrollmentOptions {
  clientId?: string;
  fetchFn?: typeof fetch;
}

export class CodexEnrollmentProvider implements EnrollmentProvider {
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly sessions = new Map<
    string,
    {
      state: EnrollmentState;
      deviceAuthId: string;
      userCode: string;
      pollIntervalMs: number;
    }
  >();
  private sequence = 0;

  constructor(options: CodexEnrollmentOptions = {}) {
    this.clientId = options.clientId ?? CODEX_CLIENT_ID;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    this.sequence += 1;
    const enrollmentId = `enr_codex_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const response = await this.fetchFn(CODEX_DEVICE_AUTH_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({ client_id: this.clientId }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Codex device auth start failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      device_auth_id?: string;
      user_code?: string;
      interval?: string | number;
    };

    if (!payload.device_auth_id || !payload.user_code) {
      throw new Error('Codex device auth returned incomplete response');
    }

    const pollIntervalMs =
      typeof payload.interval === 'number'
        ? payload.interval * 1000
        : 5000;

    const state: EnrollmentState = {
      enrollmentId,
      providerId: 'codex',
      ownerScope: input.ownerScope,
      pkceVerifier: '',
      pkceState: '',
      redirectUri: input.redirectUri,
      configVersion: 'v1.0.0',
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.sessions.set(enrollmentId, {
      state,
      deviceAuthId: payload.device_auth_id,
      userCode: payload.user_code,
      pollIntervalMs,
    });

    return {
      kind: 'device-code',
      enrollmentId,
      verificationUrl: CODEX_VERIFICATION_URL,
      userCode: payload.user_code,
      pollIntervalMs,
      expiresAt,
    };
  }

  async pollForCompletion(
    enrollmentId: string,
    maxAttempts = 60,
  ): Promise<{ accountId: string; label: string }> {
    const entry = this.sessions.get(enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${enrollmentId} not found`);
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (entry.state.cancelledAt) {
        throw new Error(`Enrollment session ${enrollmentId} was cancelled`);
      }

      const response = await this.fetchFn(CODEX_DEVICE_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          device_auth_id: entry.deviceAuthId,
          user_code: entry.userCode,
        }),
      });

      if (response.status === 403) {
        // Pending authorization — wait and retry
        await new Promise((res) => setTimeout(res, Math.min(entry.pollIntervalMs, 50)));
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Codex device poll failed (${response.status}): ${text}`);
      }

      const tokenPayload = (await response.json()) as {
        authorization_code?: string;
        code_verifier?: string;
      };

      if (!tokenPayload.authorization_code || !tokenPayload.code_verifier) {
        throw new Error('Codex device poll returned incomplete exchange payload');
      }

      // Exchange authorization code
      const exchangeBody = new URLSearchParams({
        grant_type: 'authorization_code',
        code: tokenPayload.authorization_code,
        redirect_uri: `${CODEX_AUTH_ISSUER}/deviceauth/callback`,
        client_id: this.clientId,
        code_verifier: tokenPayload.code_verifier,
      });

      const exchangeResponse = await this.fetchFn(CODEX_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body: exchangeBody,
      });

      if (!exchangeResponse.ok) {
        const text = await exchangeResponse.text().catch(() => '');
        throw new Error(`Codex OAuth token exchange failed (${exchangeResponse.status}): ${text}`);
      }

      const credPayload = (await exchangeResponse.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };

      if (!credPayload.access_token) {
        throw new Error('Codex token exchange returned no access token');
      }

      const accountId = `acct_codex_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const expiresAt = new Date(Date.now() + (credPayload.expires_in ?? 3600) * 1000).toISOString();

      return {
        accountId,
        label: `Codex Account (${accountId.slice(0, 16)})`,
      };
    }

    throw new Error('Codex device enrollment polling timed out');
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    const entry = this.sessions.get(input.enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${input.enrollmentId} not found`);
    }

    const accountId = `acct_codex_${Date.now().toString(36)}`;
    return {
      accountId,
      accessToken: `token_${input.code}`,
      expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      authClientConfigVersion: entry.state.configVersion,
    };
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    return {
      provider: 'codex',
      accountId: credential.accountId,
    };
  }

  async refresh(input: RefreshInput): Promise<PreparedCredential> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: input.credentialVersion,
      client_id: this.clientId,
    });

    const response = await this.fetchFn(CODEX_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Codex token refresh failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new Error('Codex token refresh returned no access token');
    }

    return {
      accountId: input.accountId,
      accessToken: payload.access_token,
      ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
      expiresAt: new Date(Date.now() + (payload.expires_in ?? 3600) * 1000).toISOString(),
      authClientConfigVersion: 'v1.0.0',
    };
  }

  async cancel(enrollmentId: string): Promise<void> {
    const entry = this.sessions.get(enrollmentId);
    if (entry) {
      entry.state.cancelledAt = new Date().toISOString();
    }
  }
}
