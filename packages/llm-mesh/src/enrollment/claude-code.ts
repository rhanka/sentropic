import type { ConfigResolver } from '../service/facade.js';
import { generateNonce, generatePkcePair } from './pkce.js';
import type {
  CompleteEnrollmentInput,
  EnrollmentProvider,
  EnrollmentSession,
  PreparedCredential,
  RefreshInput,
  ResolvedProviderMetadata,
  StartEnrollmentInput,
} from './contracts.js';

interface ClaudeOAuthProfile {
  id: string;
  authorizationUrl: string;
  tokenUrl: string;
  clientId: string;
  redirectUri: string;
  authorizationScopes: string[];
  refreshScopes: string[];
  requiredScopes: string[];
  source: string;
}

// Public constants verified in official Claude Code 2.1.80 (spec ledger A2).
const USER_SCOPES = ['user:profile', 'user:inference', 'user:sessions:claude_code',
  'user:mcp_servers', 'user:file_upload'];
const BUNDLED_PROFILE: ClaudeOAuthProfile = {
  id: 'claude-code-oauth-2.1.80-v1',
  authorizationUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  authorizationScopes: ['org:create_api_key', ...USER_SCOPES],
  refreshScopes: [...USER_SCOPES], requiredScopes: ['user:inference'],
  source: 'https://registry.npmjs.org/@anthropic-ai/claude-code/2.1.80',
};
const failure = (reason: string): Error => new Error(`Claude enrollment: ${reason}; reauthenticate`);
// Only local preparation failures may permit replaying the same refresh grant.
export class ClaudeRefreshPreparationError extends Error {
  constructor() { super('Claude refresh preparation failed; retry later'); }
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const token = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !/[\r\n]/.test(value);
const scopes = (value: unknown): value is string[] => Array.isArray(value)
  && value.length > 0 && value.every((item) => typeof item === 'string' && /^[a-z0-9:_-]+$/.test(item));
const httpsUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
};
function validateProfile(value: unknown): ClaudeOAuthProfile {
  if (!object(value) || typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,99}$/.test(value.id)
    || value.id === 'v1.0.0' || !httpsUrl(value.authorizationUrl) || !httpsUrl(value.tokenUrl)
    || !httpsUrl(value.redirectUri) || !httpsUrl(value.source) || !token(value.clientId)
    || !scopes(value.authorizationScopes) || !scopes(value.refreshScopes) || !scopes(value.requiredScopes)
    || !value.requiredScopes.includes('user:inference')
    || !value.requiredScopes.every((scope) => (value.authorizationScopes as string[]).includes(scope)
      && (value.refreshScopes as string[]).includes(scope))) throw failure('invalid OAuth profile');
  const profile: ClaudeOAuthProfile = { id: value.id, authorizationUrl: value.authorizationUrl,
    tokenUrl: value.tokenUrl, redirectUri: value.redirectUri, clientId: value.clientId,
    source: value.source, authorizationScopes: [...value.authorizationScopes],
    refreshScopes: [...value.refreshScopes], requiredScopes: [...value.requiredScopes] };
  if (profile.id === BUNDLED_PROFILE.id && JSON.stringify(profile) !== JSON.stringify({
    ...profile, ...BUNDLED_PROFILE,
  })) throw failure('reserved OAuth profile');
  return profile;
}

export interface ClaudeCodeEnrollmentOptions {
  configResolver?: ConfigResolver;
  fetchFn?: typeof fetch;
  nowFn?: () => number;
}

interface ClaudeSession {
  profile: ClaudeOAuthProfile;
  verifier: string;
  state: string;
  expiresAt: number;
  consumed: boolean;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout>;
}

export class ClaudeCodeEnrollmentProvider implements EnrollmentProvider {
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly metadata = new WeakMap<PreparedCredential, ResolvedProviderMetadata>();
  private readonly sessions = new Map<string, ClaudeSession>();
  constructor(private readonly options: ClaudeCodeEnrollmentOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.nowFn ?? Date.now;
  }

  private async profile(configRef: string, refresh = false): Promise<ClaudeOAuthProfile> {
    if (refresh && configRef === BUNDLED_PROFILE.id) return BUNDLED_PROFILE;
    if (refresh && (!configRef || configRef === 'v1.0.0')) throw failure('unknown OAuth profile');
    let value: unknown;
    try { value = await this.options.configResolver?.resolveConfig(configRef); }
    catch {
      if (refresh) throw new ClaudeRefreshPreparationError();
      throw failure('OAuth profile resolution failed');
    }
    if (!this.options.configResolver || (object(value) && Object.keys(value).length === 0)) {
      if (refresh) throw failure('unknown OAuth profile');
      return BUNDLED_PROFILE;
    }
    const profile = validateProfile(value);
    if (refresh && profile.id !== configRef) throw failure('OAuth profile version mismatch');
    return profile;
  }

  async start(input: StartEnrollmentInput): Promise<EnrollmentSession> {
    if (!input.ownerScope?.trim()) throw failure('ownerScope is required');
    const profile = await this.profile(input.configRef);
    if (input.redirectUri && input.redirectUri !== profile.redirectUri) throw failure('redirect mismatch');
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateNonce();
    const enrollmentId = `enr_claude_${generateNonce()}`;
    const expiresAt = this.now() + 15 * 60_000;
    const url = new URL(profile.authorizationUrl);
    url.search = new URLSearchParams({ code: 'true', response_type: 'code', client_id: profile.clientId,
      redirect_uri: profile.redirectUri, scope: profile.authorizationScopes.join(' '),
      code_challenge: codeChallenge, code_challenge_method: 'S256', state }).toString();
    const timer = setTimeout(() => { void this.cancel(enrollmentId); }, 15 * 60_000);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.sessions.set(enrollmentId, { profile, verifier: codeVerifier, state, expiresAt,
      consumed: false, controller: new AbortController(), timer });
    return { kind: 'authorization-url', enrollmentId, url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
  }

  async complete(input: CompleteEnrollmentInput): Promise<PreparedCredential> {
    const session = this.sessions.get(input.enrollmentId);
    if (!session || session.consumed) throw failure('session unavailable');
    session.consumed = true;
    try {
      const parts = typeof input.code === 'string' ? input.code.split('#') : [];
      if (this.now() >= session.expiresAt || parts.length !== 2 || !token(parts[0])
        || parts[1] !== session.state) throw failure('invalid code, state or expired session');
      const value = await this.exchange(session.profile, { grant_type: 'authorization_code',
        code: parts[0], state: session.state, code_verifier: session.verifier,
        client_id: session.profile.clientId, redirect_uri: session.profile.redirectUri }, session.controller);
      if (this.sessions.get(input.enrollmentId) !== session || session.controller.signal.aborted
        || this.now() >= session.expiresAt) throw failure('session cancelled or expired');
      return this.grant(value, session.profile, `acct_claude_${generateNonce()}`, 'browser');
    } finally { await this.cancel(input.enrollmentId); }
  }

  async importCredential(credentialJson: string): Promise<PreparedCredential> {
    if (typeof credentialJson !== 'string' || new TextEncoder().encode(credentialJson).length > 65_536) {
      throw failure('invalid credential document');
    }
    let value: unknown;
    try { value = JSON.parse(credentialJson); } catch {
      throw failure('Paste the renewable Claude CLI credential or use browser enrollment');
    }
    if (object(value) && Object.hasOwn(value, 'claudeAiOauth')) value = value.claudeAiOauth;
    if (!object(value)) throw failure('invalid credential document');
    const profile = await this.profile('claude-code');
    return this.prepare(value.accessToken, value.refreshToken, value.expiresAt, value.scopes,
      profile, `acct_claude_${generateNonce()}`, 'credential-import');
  }

  async resolve(credential: PreparedCredential): Promise<ResolvedProviderMetadata> {
    const metadata = this.metadata.get(credential);
    return metadata ? { ...metadata, scopes: [...metadata.scopes as string[]] } : {};
  }

  private prepare(access: unknown, refresh: unknown, expiry: unknown, grantedScopes: unknown,
    profile: ClaudeOAuthProfile, accountId: string, method: string): PreparedCredential {
    if (!token(access) || !token(refresh) || typeof expiry !== 'number' || expiry <= 0
      || !Number.isFinite(expiry) || !Number.isFinite(new Date(expiry).getTime())
      || !scopes(grantedScopes) || !profile.requiredScopes.every((scope) => grantedScopes.includes(scope))
      || !grantedScopes.every((scope) => profile.authorizationScopes.includes(scope))) {
      throw failure('invalid renewable grant');
    }
    const credential = { accountId, accessToken: access, refreshToken: refresh,
      expiresAt: new Date(expiry).toISOString(), authClientConfigVersion: profile.id };
    this.metadata.set(credential, { billing_type: 'seat', enrollmentMethod: method,
      authClientConfigVersion: profile.id, refreshManagement: 'mesh', scopes: [...grantedScopes] });
    return credential;
  }

  private grant(value: unknown, profile: ClaudeOAuthProfile, accountId: string,
    method: string, previousRefresh?: string, previousScopes?: unknown): PreparedCredential {
    if (!object(value) || typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in)
      || value.expires_in <= 0 || (Object.hasOwn(value, 'scope') && typeof value.scope !== 'string')) {
      throw failure('invalid token response');
    }
    const expiry = this.now() + value.expires_in * 1000;
    if (expiry <= this.now()) throw failure('invalid token expiry');
    return this.prepare(value.access_token,
      Object.hasOwn(value, 'refresh_token') ? value.refresh_token : previousRefresh,
      expiry, typeof value.scope === 'string' ? value.scope.split(' ') : previousScopes,
      profile, accountId, method);
  }

  private async exchange(profile: ClaudeOAuthProfile, body: Record<string, string>,
    controller = new AbortController()): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(failure('token request timed out')); }, 30_000);
    });
    try {
      return await Promise.race([deadline, (async () => {
        let response: Response;
        let value: unknown;
        try {
          response = await this.fetchFn(profile.tokenUrl, { method: 'POST', redirect: 'error',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        } catch { throw failure('token request failed'); }
        try { value = await response.json(); }
        catch { throw failure(`HTTP ${response.status} invalid_response`); }
        if (!response.ok) {
          const code = object(value) && typeof value.error === 'string'
            && ['invalid_grant', 'invalid_request', 'invalid_client', 'unauthorized_client',
              'unsupported_grant_type', 'invalid_scope', 'access_denied'].includes(value.error) ? value.error : 'oauth_error';
          throw failure(`HTTP ${response.status} ${code}`);
        }
        return value;
      })()]);
    } finally { clearTimeout(timer); }
  }

  async refresh(input: RefreshInput & { grantedScopes?: unknown }): Promise<PreparedCredential> {
    const profile = await this.profile(input.credentialVersion, true);
    if (!token(input.refreshToken)) throw new ClaudeRefreshPreparationError();
    const value = await this.exchange(profile, { grant_type: 'refresh_token',
      refresh_token: input.refreshToken, client_id: profile.clientId, scope: profile.refreshScopes.join(' ') });
    return this.grant(value, profile, input.accountId, 'refresh', input.refreshToken, input.grantedScopes);
  }

  async cancel(enrollmentId: string): Promise<void> {
    const session = this.sessions.get(enrollmentId);
    if (!session) return;
    this.sessions.delete(enrollmentId);
    clearTimeout(session.timer);
    session.controller.abort();
    session.verifier = '';
    session.state = '';
  }
}
