import type { ConfigResolver } from '../service/facade.js';
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
import type { LoopbackServer } from './pkce.js';
import { createLoopbackServer, generateNonce, generatePkcePair } from './pkce.js';

export const CLOUD_CODE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const CLOUD_CODE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const CLOUD_CODE_LOAD_CODE_ASSIST_URL =
  'https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist';
export const CLOUD_CODE_USER_AGENT =
  'antigravity/cli/1.1.10 (aidev_client; os_type=linux; arch=amd64; auth_method=consumer)';

export const CLOUD_CODE_CLIENT_ID =
  '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
export const CLOUD_CODE_CLIENT_SECRET = 'GOCSPX-vP2-9_7a3d-example_secret';

export interface CloudCodeEnrollmentOptions {
  clientId?: string;
  clientSecret?: string;
  configResolver?: ConfigResolver;
  fetchFn?: typeof fetch;
}

export class CloudCodeEnrollmentProvider implements EnrollmentProvider {
  private readonly defaultClientId: string;
  private readonly defaultClientSecret: string;
  private readonly configResolver?: ConfigResolver;
  private readonly fetchFn: typeof fetch;
  private readonly sessions = new Map<
    string,
    { state: EnrollmentState; loopback?: LoopbackServer }
  >();
  private sequence = 0;

  constructor(options: CloudCodeEnrollmentOptions = {}) {
    this.defaultClientId = options.clientId ?? CLOUD_CODE_CLIENT_ID;
    this.defaultClientSecret = options.clientSecret ?? '';
    this.configResolver = options.configResolver;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  private async getSecrets(configRef?: string): Promise<{ clientId: string; clientSecret: string }> {
    if (this.configResolver && configRef) {
      try {
        const config = await this.configResolver.resolveConfig(configRef);
        const clientId =
          typeof config.clientId === 'string' && config.clientId.trim().length > 0
            ? config.clientId
            : this.defaultClientId;
        const clientSecret =
          typeof config.clientSecret === 'string' && config.clientSecret.trim().length > 0
            ? config.clientSecret
            : this.defaultClientSecret;
        return { clientId, clientSecret };
      } catch {
        // Fall back to default secrets if resolver fails or yields empty
      }
    }
    return { clientId: this.defaultClientId, clientSecret: this.defaultClientSecret };
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    this.sequence += 1;
    const enrollmentId = `enr_cc_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const pkceState = generateNonce();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { clientId } = await this.getSecrets(input.configRef);

    let redirectUri = input.redirectUri;
    let loopback: LoopbackServer | undefined;

    if (
      input.mode === 'cli' &&
      (!redirectUri || redirectUri.includes('127.0.0.1') || redirectUri.includes('localhost'))
    ) {
      loopback = await createLoopbackServer(pkceState);
      redirectUri = loopback.redirectUri;
    }

    const url = new URL(CLOUD_CODE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set(
      'scope',
      'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email',
    );
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', pkceState);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    const state: EnrollmentState = {
      enrollmentId,
      providerId: 'cloud-code',
      ownerScope: input.ownerScope,
      pkceVerifier: codeVerifier,
      pkceState,
      redirectUri,
      configVersion: 'v1.0.0',
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.sessions.set(enrollmentId, { state, loopback });

    return {
      kind: 'authorization-url',
      enrollmentId,
      url: url.toString(),
      expiresAt,
    };
  }

  async waitForCallback(enrollmentId: string): Promise<{ accountId: string; label: string }> {
    const entry = this.sessions.get(enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${enrollmentId} not found`);
    }

    if (entry.state.cancelledAt) {
      throw new Error(`Enrollment session ${enrollmentId} was cancelled`);
    }

    let code: string;
    if (entry.loopback) {
      try {
        const res = await entry.loopback.waitForCallback();
        code = res.code;
      } finally {
        await entry.loopback.close();
      }
    } else {
      throw new Error('No loopback server active for waitForCallback');
    }

    const cred = await this.complete({ enrollmentId, code });
    const meta = await this.resolve(cred);

    return {
      accountId: cred.accountId,
      label:
        cred.accountEmail ??
        (meta.cloudaicompanionProject
          ? `Cloud Code (${meta.cloudaicompanionProject})`
          : 'Cloud Code Account'),
    };
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    const entry = this.sessions.get(input.enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${input.enrollmentId} not found`);
    }

    if (entry.state.consumedAt) {
      throw new Error(`Enrollment session ${input.enrollmentId} already consumed`);
    }
    if (entry.state.cancelledAt) {
      throw new Error(`Enrollment session ${input.enrollmentId} was cancelled`);
    }

    entry.state.consumedAt = new Date().toISOString();
    const { clientId, clientSecret } = await this.getSecrets();

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: entry.state.redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: entry.state.pkceVerifier,
    });

    const response = await this.fetchFn(CLOUD_CODE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Cloud Code token exchange failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new Error('Cloud Code token exchange returned no access token.');
    }

    const expiresInMs = (payload.expires_in ?? 3600) * 1000;
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();
    const accountId = `acct_cc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    return {
      accountId,
      accessToken: payload.access_token,
      ...(payload.refresh_token ? { refreshToken: payload.refresh_token } : {}),
      expiresAt,
      authClientConfigVersion: entry.state.configVersion,
    };
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    const response = await this.fetchFn(CLOUD_CODE_LOAD_CODE_ASSIST_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.accessToken}`,
        'User-Agent': CLOUD_CODE_USER_AGENT,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Cloud Code loadCodeAssist failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { cloudaicompanionProject?: string };
    if (!payload.cloudaicompanionProject || payload.cloudaicompanionProject.trim().length === 0) {
      throw new Error('Cloud Code loadCodeAssist returned no cloudaicompanionProject');
    }

    return {
      cloudaicompanionProject: payload.cloudaicompanionProject.trim(),
      cloudCodeUserAgentVersion: '1.1.10',
    };
  }

  async refresh(input: RefreshInput): Promise<PreparedCredential> {
    const refreshToken = input.refreshToken ?? input.credentialVersion;
    if (!refreshToken || refreshToken === 'v1.0.0') {
      throw new Error('Cloud Code token refresh failed: invalid or missing refresh token');
    }

    const { clientId, clientSecret } = await this.getSecrets();

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const response = await this.fetchFn(CLOUD_CODE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Cloud Code token refresh failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };

    if (!payload.access_token) {
      throw new Error('Cloud Code token refresh returned no access token');
    }

    const expiresInMs = (payload.expires_in ?? 3600) * 1000;
    const expiresAt = new Date(Date.now() + expiresInMs).toISOString();

    return {
      accountId: input.accountId,
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token ?? refreshToken,
      expiresAt,
      authClientConfigVersion: 'v1.0.0',
    };
  }

  async cancel(enrollmentId: string): Promise<void> {
    const entry = this.sessions.get(enrollmentId);
    if (!entry) return;

    entry.state.cancelledAt = new Date().toISOString();
    if (entry.loopback) {
      await entry.loopback.close();
    }
  }
}
