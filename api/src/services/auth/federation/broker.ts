import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import { FederationCompletionRefusal } from './types';

import type {
  FederationBroker,
  FederationBrokerDeps,
  FederationCallbackRequest,
  FederationCallbackResult,
  FederationEmailChallengeCompletion,
  FederationErrorResult,
  FederationIdentityAttempt,
  FederationLinkCallbackRequest,
  FederationLinkResult,
  FederationProviderIdentity,
  FederationStartRequest,
  FederationStartResult,
} from './types';

/**
 * BR-39e Lot 1/2 — the federation BROKER core (D1, security-critical).
 *
 * Provider-agnostic: it composes the injected `FederationProvider` (upstream RP round-trip),
 * the Lot 0 `federation` port (identities + one-time flow-state), the SAFE resolver
 * `resolveOrCreateFederatedUser` (D6/D7/D8), and a session mint (D10 rotation). It is a PURE
 * async unit — no Hono, no DB, no arctic — so every keystone (K-STATE/K-FLOW/K-NONCE/K-SEALED/
 * K-NOLEAK/K-AUTOLINK/K-NOMERGE-CRED/K-ROTATE, and Lot 2 K-GH-NOVERIFIED/K-GH-MANUAL/
 * K-GH-SUBJECT/K-MANUAL-LINK-AUTH) is unit-tested with in-memory fakes.
 *
 * Invariants encoded here:
 *  - D5: the sealed OAuth continuation is stored server-side in the flow-state as a POINTER and
 *    is NEVER passed to the provider. Only `state`+`nonce`+PKCE travel upstream (K-SEALED).
 *  - D5/D10: the callback consumes the one-time flow-state (verify-and-delete), checks the CSRF
 *    `state` and (via the provider) the id_token nonce/sig/iss/aud before trusting anything.
 *  - D1: the external tokens live only inside `provider.verifyCallback`; the broker sees only a
 *    verified {subject,email,emailVerified} and mints the IdP's OWN session (K-NOLEAK).
 *  - D7/D8/OD2: a credentialed-account collision is NEVER silently merged; it returns a safe
 *    "account exists, sign in to link" signal. The ONLY path that attaches a provider to a
 *    credentialed account is the AUTHENTICATED manual-link callback (`linkCallback`, D7/§3.3 step 6).
 *  - D9: a provider with no usable verified email NEVER creates a no-email user; the broker returns
 *    an `email-challenge` outcome and `completeEmailChallenge` finishes once an email is proven.
 *  - D11: success resumes the sealed continuation (server-side) or lands on a FIXED internal page.
 */
export const createFederationBroker = (deps: FederationBrokerDeps): FederationBroker => {
  const {
    audit,
    clock,
    config,
    federation,
    provider,
    secrets,
  } = deps;

  const resumeLocation = (continuation: string): string => {
    const url = new URL(config.authorizeUrl);
    url.searchParams.set('continue', continuation);
    return url.toString();
  };

  const errorResult = (
    status: number,
    code: string,
    message: string,
    clearFlowCookie = true,
  ): FederationErrorResult => ({
    body: { error: { code, message } },
    clearFlowCookie,
    kind: 'error',
    status,
  });

  const completed = async <T>(operation: (attempt: FederationIdentityAttempt) => Promise<T>)
    : Promise<T | FederationErrorResult> => {
    try { return await deps.complete(operation); }
    catch (error) {
      // This catch is outside the UOW: no SQL may follow a transaction-aborting conflict.
      if (error instanceof FederationCompletionRefusal) return errorResult(error.status, error.code, error.message);
      if (error instanceof IdentityCustodyErrorV1 && error.code === 'social_subject_conflict') {
        return errorResult(409, 'identity_linked_other_account',
          'This provider account is already linked to a different Sentropic account.');
      }
      throw error;
    }
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

  /**
   * Shared state/nonce/PKCE + provider-verify preamble for BOTH the login `callback` and the
   * authenticated `linkCallback`. Consumes the one-time flow-state (verify-and-delete), enforces the
   * IdP mix-up guard, the CSRF `state` match, and the provider verification (K-FLOW/K-STATE/K-NONCE),
   * then returns the verified identity + the flow-state (for the continuation pointer). Any failure
   * is surfaced as a ready-to-return error result so both callers stay identical on the security path.
   */
  const runFlowAndVerify = async (
    request: FederationCallbackRequest,
  ): Promise<
    | { ok: true; identity: FederationProviderIdentity; continuation: string | null; expiresAt: string }
    | { ok: false; result: FederationErrorResult }
  > => {
    const now = clock.now();

    if (!request.flowStateId) {
      return {
        ok: false,
        result: errorResult(400, 'federation_flow_missing', 'Missing federation flow state.', false),
      };
    }

    // K-FLOW / K-STATE (replay + TTL): verify-and-DELETE. A replay, an expired state, or a second
    // consume all return null — a single atomic statement in the adapter, no read-then-delete race.
    const flowState = await federation.consumeFlowState(request.flowStateId, now);
    if (!flowState) {
      await audit.record('warn', 'federation.flow_invalid', { provider: provider.id });
      return {
        ok: false,
        result: errorResult(
          400,
          'federation_flow_invalid',
          'Federation flow state is missing, expired, or already used.',
        ),
      };
    }

    // IdP mix-up guard: a flow-state minted for one provider MUST be consumed on that SAME provider's
    // callback (defence against a cross-provider flow-state swap).
    if (flowState.provider !== provider.id) {
      await audit.record('warn', 'federation.provider_mismatch', {
        expected: flowState.provider,
        provider: provider.id,
      });
      return {
        ok: false,
        result: errorResult(400, 'federation_provider_mismatch', 'Federation provider mismatch.'),
      };
    }

    if (request.error) {
      await audit.record('warn', 'federation.provider_error', {
        error: request.error,
        provider: provider.id,
      });
      return {
        ok: false,
        result: errorResult(400, 'federation_provider_error', 'The upstream provider returned an error.'),
      };
    }

    // K-STATE: the echoed CSRF `state` must match the server-side flow-state exactly.
    if (!request.state || request.state !== flowState.upstreamState) {
      await audit.record('warn', 'federation.state_mismatch', { provider: provider.id });
      return {
        ok: false,
        result: errorResult(400, 'federation_state_mismatch', 'Federation state mismatch.'),
      };
    }

    if (!request.code) {
      return {
        ok: false,
        result: errorResult(400, 'federation_code_missing', 'Missing authorization code.'),
      };
    }

    // K-NONCE / K-NOLEAK: the provider exchanges the code and verifies the identity internally,
    // returning ONLY a verified identity. The external tokens never reach the broker.
    let identity: FederationProviderIdentity;
    try {
      identity = await provider.verifyCallback({
        code: request.code,
        codeVerifier: flowState.codeVerifier,
        nonce: flowState.nonce,
        profile: request.profile,
      });
    } catch (error) {
      await audit.record('warn', 'federation.verify_failed', {
        err: error instanceof Error ? error.message : String(error),
        provider: provider.id,
      });
      return {
        ok: false,
        result: errorResult(401, 'federation_verification_failed', 'Federation verification failed.'),
      };
    }

    const expiresAt = Math.min(flowState.expiresAt.getTime(),
      identity.assertionExpiresAt ? Date.parse(identity.assertionExpiresAt) : Infinity);
    if (!Number.isFinite(expiresAt)) throw new Error('Invalid federation assertion expiry');
    // Provider verification pins issuer/audience/tenant/subject once. Retry uses only this
    // immutable copy; neither the one-time exchange nor transient flow consumption is repeated.
    return { continuation: flowState.continuationToken, identity: Object.freeze({ ...identity }),
      expiresAt: new Date(expiresAt).toISOString(), ok: true };
  };

  const requireFreshAssertion = (expiresAt: string, now: Date): void => {
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
      throw new FederationCompletionRefusal(401, 'federation_verification_failed', 'Federation verification failed.');
    }
  };

  /** Load the user, mint a FRESH rotated session (D10), and resume the continuation or land (D11). */
  const authenticatedResult = async (
    attempt: FederationIdentityAttempt,
    userId: string,
    continuation: string | null,
    deviceInfo: FederationCallbackRequest['deviceInfo'],
    outcomeKind: string,
  ): Promise<FederationCallbackResult> => {
    await attempt.consumeEmailProof(userId);
    const session = await attempt.authenticate(userId, deviceInfo);

    await attempt.audit.record('info', 'federation.login', {
      outcome: outcomeKind,
      provider: provider.id,
      sessionId: session.sessionId,
      userId,
    });

    const location = continuation ? resumeLocation(continuation) : config.landingUrl;
    return { kind: 'authenticated', location, session };
  };

  /**
   * Run the SAFE resolver on a verified identity and turn its outcome into a callback result. Shared
   * by the login `callback` (provider-verified email) and `completeEmailChallenge` (locally-proven
   * email). Encodes D7/D8/D9/OD2: never silently merge, no no-email user, subject-first.
   */
  const resolveAndFinish = async (
    attempt: FederationIdentityAttempt,
    identity: FederationProviderIdentity,
    continuation: string | null,
    deviceInfo: FederationCallbackRequest['deviceInfo'],
    expiresAt: string,
  ): Promise<FederationCallbackResult> => {
    const outcome = await attempt.resolveFederatedUser(
      {
        email: identity.email,
        emailVerifiedByProvider: identity.emailVerified,
        now: attempt.now,
        provider: provider.id,
        providerSubject: identity.subject,
        providerTenant: identity.providerTenant ?? null,
      },
    );

    switch (outcome.kind) {
      case 'manual-link-required':
        // K-NOMERGE-CRED / K-GH-MANUAL (D7/D8/OD2): never merge; surface a safe "sign in to link"
        // signal. GitHub always lands here on a collision (never on the auto-link allowlist, D8).
        await attempt.audit.record('warn', 'federation.manual_link_required', {
          provider: provider.id,
          reason: outcome.reason,
        });
        return errorResult(
          409,
          'account_exists_sign_in_to_link',
          'An account with this email already exists. Sign in with your existing method, then link this provider from settings.',
        );
      case 'email-challenge-required':
        // D9 / K-GH-NOVERIFIED: no usable verified email — no user/identity row was written. The route
        // drives a local email-verification challenge, then calls `completeEmailChallenge`.
        await attempt.audit.record('info', 'federation.email_challenge_required', { provider: provider.id });
        return {
          continuation,
          kind: 'email-challenge',
          expiresAt,
          provider: provider.id,
          providerSubject: outcome.providerSubject,
          providerTenant: identity.providerTenant ?? null,
        };
      case 'auto-linked':
      case 'created':
      case 'linked-existing':
        return authenticatedResult(attempt, outcome.userId, continuation, deviceInfo, outcome.kind);
    }
  };

  const callback = async (request: FederationCallbackRequest): Promise<FederationCallbackResult> => {
    const verified = await runFlowAndVerify(request);
    if (!verified.ok) return verified.result;
    return completed(attempt => {
      requireFreshAssertion(verified.expiresAt, attempt.now);
      return resolveAndFinish(attempt, verified.identity, verified.continuation, request.deviceInfo, verified.expiresAt);
    });
  };

  const linkCallback = async (request: FederationLinkCallbackRequest): Promise<FederationLinkResult> => {
    // K-MANUAL-LINK-AUTH (D7): the ONLY path attaching a provider to a credentialed account requires a
    // valid session. An unauthenticated link callback is rejected BEFORE any flow-state is consumed or
    // any identity is verified — no silent link.
    if (!request.linkUserId) {
      await audit.record('warn', 'federation.link_unauthenticated', { provider: provider.id });
      return errorResult(401, 'authentication_required', 'Sign in before linking a provider.');
    }
    const linkUserId = request.linkUserId;

    const verified = await runFlowAndVerify(request);
    if (!verified.ok) return verified.result;
    const { identity } = verified;
    return completed(async attempt => {
      // The session and subject lock are revalidated after upstream I/O, on EVERY attempt.
      await attempt.requireLinkActor(linkUserId);
      requireFreshAssertion(verified.expiresAt, attempt.now);
      const existing = await attempt.federation.findIdentityBySubject(provider.id, identity.subject);
      if (existing) {
        if (existing.userId !== linkUserId) {
          throw new IdentityCustodyErrorV1('social_subject_conflict');
        }
        await attempt.federation.touchLogin(existing.id, attempt.now);
        await attempt.audit.record('info', 'federation.link_idempotent', {
          provider: provider.id,
          userId: linkUserId,
        });
        return { identity: existing, kind: 'linked' as const, userId: linkUserId };
      }

      // r6 §4.10: an insertion/touch race escapes the callback. Only CM may retry after rollback.
      const linked = await attempt.federation.linkIdentity({
        emailAtLink: identity.email,
        emailVerifiedByProvider: identity.emailVerified,
        now: attempt.now,
        provider: provider.id,
        providerSubject: identity.subject,
        providerTenant: identity.providerTenant ?? null,
        userId: linkUserId,
      });
      await attempt.audit.record('info', 'federation.linked', { provider: provider.id, userId: linkUserId });
      return { identity: linked, kind: 'linked' as const, userId: linkUserId };
    });
  };

  const completeEmailChallenge = async (
    input: FederationEmailChallengeCompletion,
  ): Promise<FederationCallbackResult> => {
    // Defensive: the route builds a provider-specific broker; the pending `provider` must match it.
    if (input.provider !== provider.id) {
      return errorResult(400, 'federation_provider_mismatch', 'Federation provider mismatch.', false);
    }
    // The just-proven email is treated as provider-verified (D9, §3.3 step 4→5): the pending identity
    // re-enters the SAFE resolver at the collision step. For GitHub a collision routes to manual-link
    // (never auto-link, D8); no collision creates the shell user + links the identity.
    const identity: FederationProviderIdentity = {
      email: input.verifiedEmail,
      emailVerified: true,
      providerTenant: input.providerTenant ?? null,
      subject: input.providerSubject,
    };
    return completed(async attempt => {
      requireFreshAssertion(input.expiresAt, attempt.now);
      await attempt.verifyEmailProof(input.verifiedEmail, input.verificationToken);
      return resolveAndFinish(attempt, identity, input.continuation, input.deviceInfo, input.expiresAt);
    });
  };

  return { callback, completeEmailChallenge, linkCallback, start };
};
