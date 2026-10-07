// @sentropic/llm-mesh/enrollment/mistral-vibe.ts
//
// Mistral Vibe native browser sign-in — the same flow the Vibe Code CLI
// uses (mirrors mistralai/mistral-vibe, verified 2026-09-30 against a Pro
// plan by the oh-my-pi project and re-checked against Mistral docs
// 2026-10-07):
// 1. POST {console}/api/vibe/sign-in { code_challenge,
//    code_challenge_method: "S256" } (no auth header)
//    -> { process_id, sign_in_url, poll_url, expires_at }
// 2. The user approves in the browser at sign_in_url.
// 3. Poll GET poll_url -> { status: "pending" | "completed" | "expired" |
//    "denied" | "error", exchange_token? } (HTTP 410 once the process
//    expires).
// 4. POST {console}/api/vibe/sign-in/{process_id}/exchange
//    { exchange_token, code_verifier } -> { api_key }
//
// The minted key is a regular Mistral API key: it authenticates
// api.mistral.ai/v1 and its usage is billed against the signed-in plan's
// Vibe Code quota instead of pay-as-you-go API credits. It is long-lived
// and carries no refresh token: `refresh` fails closed so the account
// service surfaces reauth instead of silently minting credentials.

import { generatePkcePair } from './pkce.js';
import type {
  CompleteEnrollmentInput,
  CompletedEnrollment,
  EnrollmentProvider,
  EnrollmentSession,
  EnrollmentState,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

export const MISTRAL_VIBE_AUTH_BASE_URL = 'https://console.mistral.ai';
export const MISTRAL_VIBE_SIGN_IN_PATH = '/api/vibe/sign-in';
export const MISTRAL_VIBE_SIGN_IN_URL = `${MISTRAL_VIBE_AUTH_BASE_URL}${MISTRAL_VIBE_SIGN_IN_PATH}`;
export const MISTRAL_VIBE_POLL_INTERVAL_MS = 3000;
/** The minted key is long-lived; the account service treats it as such. */
export const MISTRAL_VIBE_KEY_VALIDITY_MS = 365 * 24 * 60 * 60 * 1000;

export interface MistralVibeEnrollmentOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

interface SignInProcessPayload {
  process_id?: unknown;
  sign_in_url?: unknown;
  poll_url?: unknown;
  expires_at?: unknown;
}

interface PollPayload {
  status?: unknown;
  exchange_token?: unknown;
  message?: unknown;
}

interface StoredSession {
  state: EnrollmentState;
  processId: string;
  pollUrl: string;
  signInUrl: string;
  codeVerifier: string;
  credential?: PreparedCredential;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => { setTimeout(resolve, ms); });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value === 'string' && value.length > 0) return value;
  throw new Error(`Mistral Vibe sign-in response is missing "${field}"`);
};

/** Reject any URL the sign-in server returns outside its own origin. */
const assertUrlUnderOrigin = (value: string, label: string): string => {
  const parsed = new URL(value);
  const origin = new URL(MISTRAL_VIBE_AUTH_BASE_URL);
  if (parsed.origin !== origin.origin) {
    throw new Error(`Mistral Vibe ${label} is outside the console origin: ${parsed.origin}`);
  }
  return value;
};

export class MistralVibeEnrollmentProvider implements EnrollmentProvider {
  private readonly fetchFn: typeof fetch;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly pollIntervalMs: number;
  private readonly sessions = new Map<string, StoredSession>();
  private sequence = 0;

  constructor(options: MistralVibeEnrollmentOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleepFn = options.sleep ?? defaultSleep;
    this.pollIntervalMs = options.pollIntervalMs ?? MISTRAL_VIBE_POLL_INTERVAL_MS;
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    this.sequence += 1;
    const enrollmentId = `enr_mistral_vibe_${Date.now().toString(36)}_${this.sequence.toString(36)}`;
    const { codeVerifier, codeChallenge } = generatePkcePair();

    const response = await this.fetchFn(MISTRAL_VIBE_SIGN_IN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Mistral Vibe sign-in start failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as SignInProcessPayload;
    if (!isRecord(payload)) {
      throw new Error('Mistral Vibe sign-in returned a malformed response');
    }

    const processId = requiredString(payload, 'process_id');
    const signInUrl = assertUrlUnderOrigin(requiredString(payload, 'sign_in_url'), 'sign-in url');
    const pollUrl = assertUrlUnderOrigin(requiredString(payload, 'poll_url'), 'poll url');
    const expiresAt = typeof payload.expires_at === 'string' && payload.expires_at
      ? payload.expires_at
      : new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const state: EnrollmentState = {
      enrollmentId,
      providerId: 'mistral-vibe',
      ownerScope: input.ownerScope,
      pkceVerifier: codeVerifier,
      pkceState: '',
      redirectUri: input.redirectUri,
      configVersion: 'v1.0.0',
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.sessions.set(enrollmentId, {
      state,
      processId,
      pollUrl,
      signInUrl,
      codeVerifier,
    });

    return { kind: 'authorization-url', enrollmentId, url: signInUrl, expiresAt };
  }

  async pollForCompletion(
    enrollmentId: string,
    maxAttempts = 100,
  ): Promise<CompletedEnrollment> {
    const entry = this.sessions.get(enrollmentId);
    if (!entry) {
      throw new Error(`Mistral Vibe enrollment session ${enrollmentId} not found`);
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (entry.state.cancelledAt) {
        throw new Error(`Mistral Vibe enrollment session ${enrollmentId} was cancelled`);
      }

      const response = await this.fetchFn(entry.pollUrl, {
        headers: { accept: 'application/json' },
      });

      if (response.status === 410) {
        throw new Error(`Mistral Vibe sign-in process ${entry.processId} expired`);
      }
      if (response.status === 429 || response.status >= 500) {
        await this.sleepFn(this.pollIntervalMs);
        continue;
      }
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Mistral Vibe sign-in poll failed (${response.status}): ${text}`);
      }

      const payload = (await response.json()) as PollPayload;
      if (!isRecord(payload)) {
        throw new Error('Mistral Vibe sign-in poll returned a malformed response');
      }

      const status = typeof payload.status === 'string' ? payload.status : '';
      if (status === 'pending') {
        await this.sleepFn(this.pollIntervalMs);
        continue;
      }
      if (status === 'expired') {
        throw new Error(`Mistral Vibe sign-in process ${entry.processId} expired`);
      }
      if (status === 'denied' || status === 'error') {
        throw new Error(
          `Mistral Vibe sign-in ${status}${typeof payload.message === 'string' ? `: ${payload.message}` : ''}`,
        );
      }
      if (status !== 'completed' || typeof payload.exchange_token !== 'string') {
        throw new Error(`Mistral Vibe sign-in poll returned unexpected status "${status}"`);
      }

      const credential = await this.exchange(entry, payload.exchange_token);
      entry.credential = credential;
      entry.state.consumedAt = new Date().toISOString();

      return {
        accountId: credential.accountId,
        label: `Mistral Vibe (${credential.accountId.slice(0, 20)})`,
        ownerScope: entry.state.ownerScope,
        credential,
      };
    }

    throw new Error('Mistral Vibe sign-in polling timed out');
  }

  private async exchange(entry: StoredSession, exchangeToken: string): Promise<PreparedCredential> {
    const exchangeUrl = `${MISTRAL_VIBE_SIGN_IN_URL}/${encodeURIComponent(entry.processId)}/exchange`;
    const response = await this.fetchFn(exchangeUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        exchange_token: exchangeToken,
        code_verifier: entry.codeVerifier,
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Mistral Vibe sign-in exchange failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as { api_key?: unknown };
    if (!isRecord(payload) || typeof payload.api_key !== 'string' || !payload.api_key) {
      throw new Error('Mistral Vibe sign-in exchange returned no api_key');
    }

    const accountId = `acct_mistral_vibe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return {
      accountId,
      accessToken: payload.api_key,
      expiresAt: new Date(Date.now() + MISTRAL_VIBE_KEY_VALIDITY_MS).toISOString(),
      authClientConfigVersion: entry.state.configVersion,
    };
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    const entry = this.sessions.get(input.enrollmentId);
    if (!entry) {
      throw new Error(`Mistral Vibe enrollment session ${input.enrollmentId} not found`);
    }
    if (entry.credential) {
      return entry.credential;
    }
    // The Vibe flow has no redirect callback; completion is poll-driven only.
    throw new Error('Mistral Vibe enrollment completes via pollForCompletion, not a callback code');
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    return {
      provider: 'mistral-vibe',
      accountId: credential.accountId,
    };
  }

  async refresh(_input: RefreshInput): Promise<PreparedCredential> {
    // The minted key is a long-lived API key with no refresh grant. Fail
    // closed so the account service moves the account to reauth_required.
    throw new Error('Mistral Vibe credentials do not refresh; re-enroll the account');
  }

  async cancel(enrollmentId: string): Promise<void> {
    const entry = this.sessions.get(enrollmentId);
    if (entry) {
      entry.state.cancelledAt = new Date().toISOString();
    }
  }
}
