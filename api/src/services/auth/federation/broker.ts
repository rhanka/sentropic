import { resolveOrCreateFederatedUser } from '@sentropic/auth-hono';

import type {
  FederationBroker,
  FederationBrokerDeps,
  FederationCallbackRequest,
  FederationCallbackResult,
  FederationProviderIdentity,
  FederationStartRequest,
  FederationStartResult,
} from './types';

/**
 * BR-39e Lot 1 — the federation BROKER core (D1, security-critical).
 *
 * Provider-agnostic: it composes the injected `FederationProvider` (upstream RP round-trip),
 * the Lot 0 `federation` port (identities + one-time flow-state), the SAFE resolver
 * `resolveOrCreateFederatedUser` (D6/D7/D8), and a session mint (D10 rotation). It is a PURE
 * async unit — no Hono, no DB, no arctic — so every keystone (K-STATE/K-FLOW/K-NONCE/K-SEALED/
 * K-NOLEAK/K-AUTOLINK/K-NOMERGE-CRED/K-ROTATE) is unit-tested with in-memory fakes.
 *
 * Invariants encoded here:
 *  - D5: the sealed OAuth continuation is stored server-side in the flow-state as a POINTER and
 *    is NEVER passed to the provider. Only `state`+`nonce`+PKCE travel upstream (K-SEALED).
 *  - D5/D10: the callback consumes the one-time flow-state (verify-and-delete), checks the CSRF
 *    `state` and (via the provider) the id_token nonce/sig/iss/aud before trusting anything.
 *  - D1: the external tokens live only inside `provider.verifyCallback`; the broker sees only a
 *    verified {subject,email,emailVerified} and mints the IdP's OWN session (K-NOLEAK).
 *  - D7/D8/OD2: a credentialed-account collision is NEVER silently merged; it returns a safe
 *    "account exists, sign in to link" signal.
 *  - D11: success resumes the sealed continuation (server-side) or lands on a FIXED internal page.
 */
export const createFederationBroker = (deps: FederationBrokerDeps): FederationBroker => {
  const {
    accountPolicy,
    audit,
    clock,
    config,
    federation,
    isFirstUser,
    mintSession,
    provider,
    provisionWorkspace,
    secrets,
    users,
  } = deps;

  const resumeLocation = (continuation: string): string => {
    const url = new URL(config.authorizeUrl);
    url.searchParams.set('continue', continuation);
    return url.toString();
  };

  const start = async (request: FederationStartRequest): Promise<FederationStartResult> => {
    const now = clock.now();
    const state = secrets.state();
    const nonce = secrets.nonce();
    const codeVerifier = secrets.codeVerifier();

    // The authorization URL carries ONLY state + nonce + PKCE challenge — never the continuation (K-SEALED).
    const location = await provider.createAuthorizationUrl({ codeVerifier, nonce, state });

    // The sealed `?continue=` continuation is held SERVER-SIDE as a pointer inside the flow-state (D5);
    // the browser round-trips only the opaque flow-state id (the bound cookie set by the route).
    const expiresAt = clock.addSeconds(now, config.flowStateTtlSeconds);
    const flowState = await federation.createFlowState({
      codeVerifier,
      continuationToken: request.continuation,
      expiresAt,
      nonce,
      now,
      provider: provider.id,
      upstreamState: state,
    });

    await audit.record('info', 'federation.start', { provider: provider.id });
    return { expiresAt, flowStateId: flowState.id, kind: 'redirect', location };
  };

  const callback = async (
    request: FederationCallbackRequest,
  ): Promise<FederationCallbackResult> => {
    const now = clock.now();
    const reject = (
      status: number,
      code: string,
      message: string,
      clearFlowCookie = true,
    ): FederationCallbackResult => ({
      body: { error: { code, message } },
      clearFlowCookie,
      kind: 'error',
      status,
    });

    if (!request.flowStateId) {
      return reject(400, 'federation_flow_missing', 'Missing federation flow state.', false);
    }

    // K-FLOW / K-STATE (replay + TTL): verify-and-DELETE. A replay, an expired state, or a second
    // consume all return null — a single atomic statement in the adapter, no read-then-delete race.
    const flowState = await federation.consumeFlowState(request.flowStateId, now);
    if (!flowState) {
      await audit.record('warn', 'federation.flow_invalid', { provider: provider.id });
      return reject(
        400,
        'federation_flow_invalid',
        'Federation flow state is missing, expired, or already used.',
      );
    }

    if (request.error) {
      await audit.record('warn', 'federation.provider_error', {
        error: request.error,
        provider: provider.id,
      });
      return reject(400, 'federation_provider_error', 'The upstream provider returned an error.');
    }

    // K-STATE: the echoed CSRF `state` must match the server-side flow-state exactly.
    if (!request.state || request.state !== flowState.upstreamState) {
      await audit.record('warn', 'federation.state_mismatch', { provider: provider.id });
      return reject(400, 'federation_state_mismatch', 'Federation state mismatch.');
    }

    if (!request.code) {
      return reject(400, 'federation_code_missing', 'Missing authorization code.');
    }

    // K-NONCE / K-NOLEAK: the provider exchanges the code and verifies id_token sig/iss/aud/nonce
    // internally, returning ONLY a verified identity. The external tokens never reach the broker.
    let identity: FederationProviderIdentity;
    try {
      identity = await provider.verifyCallback({
        code: request.code,
        codeVerifier: flowState.codeVerifier,
        nonce: flowState.nonce,
      });
    } catch (error) {
      await audit.record('warn', 'federation.verify_failed', {
        err: error instanceof Error ? error.message : String(error),
        provider: provider.id,
      });
      return reject(401, 'federation_verification_failed', 'Federation verification failed.');
    }

    // SAFE linking (D6/D7/D8): subject-first; verified-email collision auto-links ONLY into a
    // non-credentialed shell for an allowlisted provider; a credentialed collision never merges.
    const outcome = await resolveOrCreateFederatedUser(
      {
        accountPolicy,
        autoLinkProviders: config.autoLinkProviders,
        federation,
        isFirstUser,
        provisionWorkspace,
        users,
      },
      {
        email: identity.email,
        emailVerifiedByProvider: identity.emailVerified,
        now,
        provider: provider.id,
        providerSubject: identity.subject,
        providerTenant: identity.providerTenant ?? null,
      },
    );

    switch (outcome.kind) {
      case 'manual-link-required':
        // K-NOMERGE-CRED (D7/OD2): never merge; surface a safe "sign in to link" signal.
        await audit.record('warn', 'federation.manual_link_required', {
          provider: provider.id,
          reason: outcome.reason,
        });
        return reject(
          409,
          'account_exists_sign_in_to_link',
          'An account with this email already exists. Sign in with your existing method, then link this provider from settings.',
        );
      case 'email-challenge-required':
        // N/A for Google (always a verified email); defensive safe response — the local email
        // challenge (D9) lands in a later lot. No user/identity row was written.
        await audit.record('warn', 'federation.email_challenge_required', { provider: provider.id });
        return reject(400, 'email_verification_required', 'A verified email is required to continue.');
      case 'auto-linked':
      case 'created':
      case 'linked-existing': {
        const user = await users.findById(outcome.userId);
        if (!user) {
          await audit.record('error', 'federation.user_missing', {
            provider: provider.id,
            userId: outcome.userId,
          });
          return reject(500, 'federation_user_missing', 'User not found after federation.');
        }

        // K-ROTATE (D10): mint a FRESH session (new session id) — anti session-fixation. The
        // session role is derived from the account policy exactly as the passkey/email paths do.
        const role = await accountPolicy.resolveSessionRole(user, now);
        const session = await mintSession({
          deviceInfo: request.deviceInfo,
          user: { ...user, role },
        });

        await audit.record('info', 'federation.login', {
          outcome: outcome.kind,
          provider: provider.id,
          sessionId: session.sessionId,
          userId: user.id,
        });

        // D11: resume the sealed continuation (server-side) or land on the FIXED internal page.
        const location = flowState.continuationToken
          ? resumeLocation(flowState.continuationToken)
          : config.landingUrl;
        return { kind: 'authenticated', location, session };
      }
    }
  };

  return { callback, start };
};
