// @sentropic/llm-mesh/enrollment/muse-code.ts
//
// Native Meta device-flow enrollment (S5, §14.6 DESIGN CONTRACT implemented).
// Wire facts [MEASURED] from static analysis of the installed muse CLI
// (wrapper ~/.local/bin/muse + ELF muse-bin-1.3.0-R3401.1, read-only):
// - authorize POST https://auth.meta.com/oidc/device/authorization/
//   (client_id 1031625952748946, public RFC 8628 client),
//   form-encoded (JSON body gets a live 404 — probed 2026-09-21);
// - poll POST https://auth.meta.com/oidc/device/token/ (form-encoded,
//   grant_type urn:ietf:params:oauth:grant-type:device_code);
// - mint POST https://api.meta.ai/muse-code/key, header x-api-version 1.0.0,
//   body { dca_token } -> MintedKey{ api_key, user_email, ... } (all optional).
// The wait/backoff/fail-up policy is mutualized in ./device-flow.ts
// (shared with future providers; codex keeps its custom flow).
// [GAP] refresh grant string: standard OAuth2 refresh_token grant against
// the token endpoint (RFC 6749, not Meta-measured); re-mint after refresh.

import { createHash } from 'node:crypto';

import { runDeviceFlowUntilComplete } from './device-flow.js';
import type {
  CompletedEnrollment,
  CompleteEnrollmentInput,
  EnrollmentProvider,
  EnrollmentSession,
  EnrollmentState,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

export const MUSE_AUTH_ISSUER = 'https://auth.meta.com';
export const MUSE_DEVICE_AUTHORIZATION_URL = `${MUSE_AUTH_ISSUER}/oidc/device/authorization/`;
export const MUSE_DEVICE_TOKEN_URL = `${MUSE_AUTH_ISSUER}/oidc/device/token/`;
export const MUSE_CLIENT_ID = '1031625952748946';
export const MUSE_VERIFICATION_URL = 'https://accountscenter.meta.com/muse_code/';
export const MUSE_KEY_MINT_URL = 'https://api.meta.ai/muse-code/key';
export const MUSE_KEY_MINT_API_VERSION = '1.0.0';
export const MUSE_NATIVE_CONFIG_VERSION = 'muse-device-flow-v1';

export interface MuseCodeEnrollmentOptions {
  clientId?: string;
  fetchFn?: typeof fetch;
}

interface NativeSession {
  state: EnrollmentState;
  deviceCode: string;
  pollIntervalMs: number;
}

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

export class MuseCodeEnrollmentProvider implements EnrollmentProvider {
  private readonly clientId: string;
  private readonly fetchFn: typeof fetch;
  private readonly sessions = new Map<string, NativeSession>();
  private sequence = 0;

  constructor(options: MuseCodeEnrollmentOptions = {}) {
    this.clientId = options.clientId ?? MUSE_CLIENT_ID;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    this.sequence += 1;
    const enrollmentId = `enr_musecode_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
    // Live-probed 2026-09-21: the Meta OIDC device endpoints take
    // application/x-www-form-urlencoded (a JSON body gets a 404).
    const response = await this.fetchFn(MUSE_DEVICE_AUTHORIZATION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ client_id: this.clientId }).toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Muse device auth start failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      device_code?: unknown;
      user_code?: unknown;
      verification_uri_complete?: unknown;
      verification_uri?: unknown;
      expires_in?: unknown;
      interval?: unknown;
    };
    const deviceCode = textOf(payload.device_code);
    const userCode = textOf(payload.user_code);
    if (!deviceCode || !userCode) {
      throw new Error('Muse device auth returned incomplete response');
    }
    const verificationUrl =
      textOf(payload.verification_uri_complete)
      ?? textOf(payload.verification_uri)
      ?? MUSE_VERIFICATION_URL;
    const pollIntervalMs =
      typeof payload.interval === 'number' && payload.interval > 0
        ? payload.interval * 1000
        : 5000;
    const expiresInSec =
      typeof payload.expires_in === 'number' && payload.expires_in > 0
        ? payload.expires_in
        : 900;
    const now = new Date().toISOString();
    this.sessions.set(enrollmentId, {
      state: {
        enrollmentId,
        providerId: 'muse',
        ownerScope: input.ownerScope,
        pkceVerifier: '',
        pkceState: '',
        redirectUri: input.redirectUri,
        configVersion: MUSE_NATIVE_CONFIG_VERSION,
        createdAt: now,
        expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
      },
      deviceCode,
      pollIntervalMs,
    });
    return {
      kind: 'device-code',
      enrollmentId,
      verificationUrl,
      userCode,
      pollIntervalMs,
      expiresAt: new Date(Date.now() + expiresInSec * 1000).toISOString(),
    };
  }

  private async pollToken(deviceCode: string): Promise<
    | { status: 'pending' } | { status: 'slow_down' }
    | { status: 'denied'; error?: string } | { status: 'expired' }
    | { status: 'complete'; payload: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown } }
  > {
    const response = await this.fetchFn(MUSE_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: deviceCode,
        client_id: this.clientId,
      }).toString(),
    });
    if (!response.ok) {
      const raw = await response.text().catch(() => '');
      let error = '';
      try {
        error = String((JSON.parse(raw) as { error?: unknown }).error ?? '');
      } catch {
        error = raw.slice(0, 100);
      }
      if (error === 'authorization_pending') return { status: 'pending' };
      if (error === 'slow_down') return { status: 'slow_down' };
      if (error === 'access_denied') return { status: 'denied', error };
      if (error === 'expired_token') return { status: 'expired' };
      throw new Error(`Muse device poll failed (${response.status}): ${error.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    return { status: 'complete', payload };
  }

  private async mintApiKey(accessToken: string): Promise<{
    apiKey: string;
    email: string | null;
  }> {
    const response = await this.fetchFn(MUSE_KEY_MINT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-version': MUSE_KEY_MINT_API_VERSION,
        // Live-probed 2026-09-21: body-only mints 401; the dca token must
        // ALSO ride as Bearer alongside the { dca_token } body (200).
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ dca_token: accessToken }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Muse key mint failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      api_key?: unknown;
      user_email?: unknown;
    };
    const apiKey = textOf(payload.api_key);
    if (!apiKey) {
      throw new Error('Muse key mint returned no api_key');
    }
    return { apiKey, email: textOf(payload.user_email) };
  }

  private buildCredential(input: {
    apiKey: string;
    email: string | null;
    refreshToken?: string;
    expiresInSec?: number;
  }): PreparedCredential {
    // Same stable-id convention as the CLI import so the same Meta login
    // converges on one account across enrollment paths.
    const stableId = input.email ?? input.apiKey;
    const accountId = `acct_muse_${createHash('sha256').update(stableId).digest('hex').slice(0, 12)}`;
    return {
      accountId,
      accessToken: input.apiKey,
      ...(input.refreshToken ? { refreshToken: input.refreshToken } : {}),
      expiresAt: new Date(Date.now() + (input.expiresInSec ?? 3600) * 1000).toISOString(),
      authClientConfigVersion: MUSE_NATIVE_CONFIG_VERSION,
      ...(input.email ? { accountEmail: input.email } : {}),
    };
  }

  async pollForCompletion(
    enrollmentId: string,
    maxAttempts = 60,
  ): Promise<CompletedEnrollment> {
    const entry = this.sessions.get(enrollmentId);
    if (!entry) {
      throw new Error(`Enrollment session ${enrollmentId} not found`);
    }
    const grant = await runDeviceFlowUntilComplete({
      poll: () => this.pollToken(entry.deviceCode),
      pollIntervalMs: entry.pollIntervalMs,
      maxAttempts,
      isCancelled: () => !!entry.state.cancelledAt,
    });
    const accessToken = textOf(grant.access_token);
    if (!accessToken) {
      throw new Error('Muse device flow completed without an access token');
    }
    const minted = await this.mintApiKey(accessToken);
    const refreshToken = textOf(grant.refresh_token) ?? undefined;
    const expiresInSec = typeof grant.expires_in === 'number' ? grant.expires_in : 3600;
    const credential = this.buildCredential({
      apiKey: minted.apiKey,
      email: minted.email,
      refreshToken,
      expiresInSec,
    });
    // Same CompletedEnrollment shape as the codex device flow (mutualized
    // service handling); the caller binds the session ownerScope.
    return {
      accountId: credential.accountId,
      label: `Muse (${minted.email ?? credential.accountId})`,
      ownerScope: entry.state.ownerScope,
      credential,
    };
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    // Single-shot completion: one poll round; use pollForCompletion to wait.
    const res = await this.pollForCompletion(input.enrollmentId, 1);
    if (!res.credential) {
      throw new Error(`Enrollment session ${input.enrollmentId} did not resolve a credential`);
    }
    return res.credential;
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    return {
      provider: 'muse',
      accountId: credential.accountId,
    };
  }

  async refresh(input: RefreshInput): Promise<PreparedCredential> {
    if (!input.refreshToken) {
      throw new Error('Muse native refresh requires a refresh token');
    }
    const response = await this.fetchFn(MUSE_DEVICE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: this.clientId,
      }).toString(),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Muse token refresh failed (${response.status}): ${text.slice(0, 200)}`);
    }
    const payload = (await response.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
    };
    const accessToken = textOf(payload.access_token);
    if (!accessToken) {
      throw new Error('Muse token refresh returned no access token');
    }
    const minted = await this.mintApiKey(accessToken);
    const credential = this.buildCredential({
      apiKey: minted.apiKey,
      email: minted.email,
      refreshToken: textOf(payload.refresh_token) ?? undefined,
      expiresInSec: typeof payload.expires_in === 'number' ? payload.expires_in : 3600,
    });
    if (credential.accountId !== input.accountId) {
      throw new Error('Muse account changed during refresh');
    }
    return credential;
  }

  async cancel(enrollmentId: string): Promise<void> {
    const entry = this.sessions.get(enrollmentId);
    if (entry) {
      entry.state.cancelledAt = new Date().toISOString();
    }
  }
}
